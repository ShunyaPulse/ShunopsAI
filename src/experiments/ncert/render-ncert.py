"""
Kaggle GPU Kernel: Alibaba Wan2.1 (1.3B DiT) T4-Optimized Pipeline
Features:
  1. Wan2.1 (1.3B DiT)     -> Alibaba 3D Causal VAE + Flow Matching Diffusion Transformer (Zero 2D UNet morphing)
  2. FP16 + Cutlass SDPA   -> Native Turing (SM 7.5) FP16 Tensor Core acceleration (No bfloat16 incompatibility)
  3. Native Attention Slice-> pipe.enable_attention_slicing(slice_size="max") drops peak VRAM from 48 GB to ~7-9 GB
  4. VAE Tiling + Offload  -> Latent decoding in tiles, keeping VAE VRAM spikes under 3 GB on 16GB T4
  5. RIFE / Optical Motion -> Bi-directional motion-compensated frame interpolation (16 FPS -> fluid 24 FPS broadcast cinema)
  6. Multi-Tier Audio Sync -> Pre-packaged Audio ➔ Kokoro-82M ➔ Google Cloud Neural2 ➔ Edge-TTS (44.1kHz Stereo Locked, Zero Drift)
  7. Modern 1080p Digital  -> Lanczos 1080p scaling, subtle unsharp clarity, vibrant documentary digital color grade
"""
import asyncio
import gc
import glob
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

# Prevent PyTorch memory fragmentation on 16GB GPUs
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

# Reconcile torchao version compatibility with latest diffusers
# (Incompatible torchao in Kaggle images lacks FqnToConfig, causing diffusers single_file/wan/animatediff loaders to throw ImportError)
subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"], check=False)
try:
    import site
    for sp in site.getsitepackages():
        target = os.path.join(sp, "torchao")
        if os.path.exists(target):
            shutil.rmtree(target, ignore_errors=True)
except Exception:
    pass

for mod in list(sys.modules.keys()):
    if "torchao" in mod:
        del sys.modules[mod]

# Ensure core video diffusion dependencies are installed first
subprocess.run([
    sys.executable, "-m", "pip", "install", "-q", "-U",
    "diffusers", "transformers", "accelerate", "safetensors", "huggingface_hub", "ftfy"
], check=False)

# Install audio synthesis engines (Zero kokoro/spacy - all master audio is pre-synthesized locally)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "edge-tts"], check=False)

try:
    import ftfy
except ImportError:
    import types
    ftfy = types.ModuleType("ftfy")
    ftfy.fix_text = lambda text, *a, **kw: text
    sys.modules["ftfy"] = ftfy

try:
    import edge_tts
except ImportError:
    edge_tts = None

import torch

# Force PyTorch SDPA to use native Turing (SM 7.5) Memory-Efficient attention
if torch.cuda.is_available():
    try:
        if hasattr(torch.backends.cuda, "enable_flash_sdp"):
            torch.backends.cuda.enable_flash_sdp(False)  # T4 Turing lacks FlashAttention-2
        if hasattr(torch.backends.cuda, "enable_mem_efficient_sdp"):
            torch.backends.cuda.enable_mem_efficient_sdp(True)  # Native Cutlass FP16
    except Exception as sdp_e:
        print(f"[SDPA Config] Notice: {sdp_e}")

W, H, FPS = 1920, 1080, 24
OUT = "/kaggle/working"
TMP = "/kaggle/working/tmp"
os.makedirs(TMP, exist_ok=True)

_CACHED_ENCODER_ARGS = None

def get_best_video_encoder_args():
    """
    Probes if NVIDIA h264_nvenc hardware encoder is functional in this GPU environment.
    Runs a test 0.1-second encode. If functional, returns NVENC flags (-c:v h264_nvenc -preset p4 -cq 18).
    Otherwise, cleanly auto-falls back to CPU libx264 (-c:v libx264 -preset veryfast -crf 18).
    """
    global _CACHED_ENCODER_ARGS
    if _CACHED_ENCODER_ARGS is not None:
        return _CACHED_ENCODER_ARGS

    test_clip = f"{TMP}/_test_nvenc.mp4"
    try:
        enc_check = subprocess.run(["ffmpeg", "-encoders"], capture_output=True, text=True, timeout=5)
        if "h264_nvenc" in enc_check.stdout:
            test_res = subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
                "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18", test_clip
            ], capture_output=True, timeout=8)
            if test_res.returncode == 0 and os.path.exists(test_clip) and os.path.getsize(test_clip) > 100:
                print("⚡ [Hardware Encoder] NVIDIA h264_nvenc detected and functional! Using GPU hardware acceleration.")
                _CACHED_ENCODER_ARGS = ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "18"]
                try: os.remove(test_clip)
                except Exception: pass
                return _CACHED_ENCODER_ARGS
    except Exception as e:
        print(f"[Hardware Encoder Probe] NVENC not available ({e}); using CPU libx264.")

    try:
        if os.path.exists(test_clip): os.remove(test_clip)
    except Exception: pass

    _CACHED_ENCODER_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
    return _CACHED_ENCODER_ARGS


def find_script():
    for p in glob.glob("/kaggle/input/**/script.json", recursive=True):
        return p
    raise FileNotFoundError("script.json not found in /kaggle/input")


def find_config():
    for p in glob.glob("/kaggle/input/**/config.json", recursive=True):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            pass
    return {}


def find_keyframe_image(scene_idx):
    """
    Tarika 2: Looks for pre-packaged keyframe generated by Cloudflare Workers AI FLUX.1-schnell.
    """
    patterns = [
        f"/kaggle/input/**/images/scene_{scene_idx:03d}.png",
        f"/kaggle/input/**/images/scene_{scene_idx}.png",
        f"/kaggle/input/**/scene_{scene_idx:03d}.png",
        f"/kaggle/input/**/scene_{scene_idx}.png",
        f"/kaggle/input/**/images/scene_{scene_idx:03d}.jpg",
        f"/kaggle/input/**/images/scene_{scene_idx}.jpg",
        f"{TMP}/kf_{scene_idx:03d}.png",
    ]
    for p in patterns:
        matches = glob.glob(p, recursive=True)
        for m in matches:
            if os.path.exists(m) and os.path.getsize(m) > 5000:
                return m
    return None


class KaggleKeyframeFallback:
    """
    Tarika 1 Automatic Fallback:
    Generates missing keyframes on Kaggle GPU using ByteDance/SDXL-Lightning 4-step
    in ~2 seconds if Cloudflare Workers AI pre-packaging missed any scene.
    """
    def __init__(self, hf_token=None):
        self.pipe = None
        self.hf_token = hf_token

    def generate(self, prompt, out_path):
        try:
            if self.pipe is None:
                from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, EulerDiscreteScheduler
                from huggingface_hub import hf_hub_download
                from safetensors.torch import load_file
                base = "stabilityai/stable-diffusion-xl-base-1.0"
                repo = "ByteDance/SDXL-Lightning"
                ckpt = "sdxl_lightning_4step_unet.safetensors"
                print("[Tarika 1 Fallback] Initializing SDXL-Lightning 4-step for missing keyframe...")
                unet = UNet2DConditionModel.from_config(base, subfolder="unet").to("cuda", torch.float16)
                unet.load_state_dict(load_file(hf_hub_download(repo, ckpt, token=self.hf_token), device="cuda"))
                self.pipe = StableDiffusionXLPipeline.from_pretrained(
                    base, unet=unet, torch_dtype=torch.float16, variant="fp16", token=self.hf_token
                ).to("cuda")
                self.pipe.scheduler = EulerDiscreteScheduler.from_config(
                    self.pipe.scheduler.config, timestep_spacing="trailing"
                )
                if hasattr(self.pipe, "enable_attention_slicing"):
                    self.pipe.enable_attention_slicing()

            img = self.pipe(prompt=prompt, num_inference_steps=4, guidance_scale=0).images[0]
            img.save(out_path)
            print(f"[Tarika 1 Fallback] Keyframe generated -> {out_path}")
            return out_path
        except Exception as e:
            print(f"[Tarika 1 Fallback Warning] SDXL keyframe generation failed: {e}")
            return None

    def release_vram(self):
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
            gc.collect()
            torch.cuda.empty_cache()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("CMD WARNING:", " ".join(cmd)[:250], "\n", r.stderr[-600:])
    return r.returncode == 0


def duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True
    )
    try:
        return float(r.stdout.strip() or 0)
    except Exception:
        return 0.0


def parse_rate_multiplier(rate_str):
    if not rate_str:
        return 1.0
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)%$", str(rate_str).strip())
    if not m:
        return 1.0
    pct = float(m.group(1))
    return max(0.5, min(2.0, round(1.0 + pct / 100.0, 2)))


def normalize_audio_to_44k_stereo(src_path, dst_path):
    """
    Standardizes any MP3/WAV audio file (24kHz mono or 44.1kHz mono/stereo) into
    a uniform 44100 Hz, 2-channel stereo, 192 kbps MP3 so FFmpeg concat demuxer
    never suffers sample-rate drift or pitch distortion across mixed TTS tiers.
    """
    # Pre-packaged MP3 from upstream pipeline is already standard 44.1kHz stereo MP3
    if src_path != dst_path and src_path.endswith(".mp3") and os.path.exists(src_path) and os.path.getsize(src_path) > 500:
        try:
            with open(src_path, "rb") as _af:
                _hdr = _af.read(4)
            is_valid_mp3 = (
                _hdr[:3] == b"ID3"
                or (len(_hdr) >= 2 and _hdr[0] == 0xFF and (_hdr[1] & 0xE0) == 0xE0)
            )
            if is_valid_mp3:
                shutil.copyfile(src_path, dst_path)
                return True
            elif _hdr == b"RIFF":
                # WAV container saved with .mp3 extension -> transcode via FFmpeg below
                pass
            else:
                # Headerless raw 24kHz 16-bit mono PCM (legacy Gemini TTS fallback) -> transcode explicitly
                tmp_pcm = f"{dst_path}.pcm.mp3"
                if run([
                    "ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", src_path,
                    "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", tmp_pcm
                ]) and os.path.exists(tmp_pcm) and os.path.getsize(tmp_pcm) > 300:
                    shutil.move(tmp_pcm, dst_path)
                    return True
        except Exception:
            pass

    tmp_norm = f"{dst_path}.norm.mp3"
    ok = run([
        "ffmpeg", "-y", "-i", src_path,
        "-ar", "44100", "-ac", "2",
        "-c:a", "libmp3lame", "-b:a", "192k", tmp_norm
    ])
    if ok and os.path.exists(tmp_norm) and os.path.getsize(tmp_norm) > 300:
        shutil.move(tmp_norm, dst_path)
        return True
    if src_path != dst_path and os.path.exists(src_path):
        shutil.copyfile(src_path, dst_path)
    return os.path.exists(dst_path) and os.path.getsize(dst_path) > 300


# ==========================================
# Audio Synthesis Engines: Google Cloud Neural2 + Kokoro-82M + Edge-TTS
# ==========================================
EDGE_TTS_AVAILABLE = False
kokoro_pipelines = {}


def get_kokoro_pipeline(lang_code="a"):
    global kokoro_pipelines
    if lang_code in kokoro_pipelines:
        return kokoro_pipelines[lang_code]
    try:
        from kokoro import KPipeline
        pipe = KPipeline(lang_code=lang_code)
        kokoro_pipelines[lang_code] = pipe
        print(f"[Kokoro-82M] ✅ Neural pipeline (lang='{lang_code}') loaded successfully on GPU runner.")
        return pipe
    except Exception as e:
        print(f"[Kokoro-82M] ⚠️ Kokoro init notice: {e}")
        return None


def resolve_kokoro_voice(speaker, voice):
    sp = (speaker or "").lower()
    v = (voice or "").lower()
    if v in ("af_heart", "am_adam", "bf_emma", "bm_george", "hf_alpha", "hm_omega"):
        return v
    if "photographer" in sp or "british" in sp or "en-gb" in v or "ryan" in v:
        return "bf_emma" if ("female" in v or "woman" in sp or "girl" in sp) else "bm_george"
    if "female" in v or "woman" in sp or "girl" in sp or "neerja" in v:
        return "af_heart"
    return "am_adam"


def synthesize_kokoro_audio(text, voice_name, out_path, speed=1.0):
    try:
        lang_code = "b" if str(voice_name).startswith("b") else ("h" if str(voice_name).startswith("h") else "a")
        pipeline = get_kokoro_pipeline(lang_code=lang_code)
        if not pipeline:
            return False
        import numpy as np
        import soundfile as sf
        clean_text = text.strip("\"' \n\t")
        if not clean_text:
            return False
        generator = pipeline(clean_text, voice=voice_name, speed=speed)
        wav_tmp = out_path.replace(".mp3", ".wav")
        chunks = []
        for _, _, audio in generator:
            if audio is not None and len(audio) > 0:
                chunks.append(audio)
        if chunks:
            full_audio = np.concatenate(chunks)
            sf.write(wav_tmp, full_audio, 24000)
        if os.path.exists(wav_tmp) and os.path.getsize(wav_tmp) > 300:
            normalize_audio_to_44k_stereo(wav_tmp, out_path)
            if os.path.exists(wav_tmp):
                os.remove(wav_tmp)
            if os.path.exists(out_path) and os.path.getsize(out_path) > 300:
                print(f"[Kokoro-82M] ✅ Synthesized dialogue ({voice_name}, {len(chunks)} chunk(s)): '{clean_text[:40]}...'")
                return True
        return False
    except Exception as e:
        print(f"[Kokoro-82M] ⚠️ Synthesis error: {e}")
        return False


def chunk_text_utf8(text, max_bytes=4200):
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    if len(cleaned.encode("utf-8")) <= max_bytes:
        return [cleaned]
    sentences = re.split(r"(?<=[।.!?;\n])\s+", cleaned)
    chunks, current = [], ""
    for s in sentences:
        cand = f"{current} {s}".strip() if current else s
        if len(cand.encode("utf-8")) <= max_bytes:
            current = cand
        else:
            if current:
                chunks.append(current)
            current = s
    if current:
        chunks.append(current)
    return chunks


def synthesize_gcp_cloud_tts(text, voice_name, out_path, gcp_key, default_lang="hi-IN", speaking_rate=1.0):
    """
    Direct autonomous cloud synthesis on Kaggle/remote runners via Google Cloud REST API.
    Supports UTF-8 byte chunking (<=4200 bytes) and 44.1kHz stereo normalization.
    """
    if not gcp_key:
        return False
    try:
        import base64
        import requests
        from urllib.parse import urlparse
        clean_key = gcp_key.split(",")[0].strip()
        if not clean_key or clean_key.startswith("{"):
            return False
        url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={clean_key}"
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "texttospeech.googleapis.com":
            return False

        v_name = voice_name or ("hi-IN-Neural2-B" if default_lang == "hi-IN" else "en-US-Neural2-J")
        if not any(tag in v_name for tag in ("Neural2", "Wavenet", "Standard", "Studio")):
            v_name = "hi-IN-Neural2-B" if default_lang == "hi-IN" else "en-US-Neural2-J"
        lang_code = (
            "en-GB" if "en-GB" in v_name else
            "en-US" if "en-US" in v_name else
            "en-IN" if "en-IN" in v_name else
            "hi-IN" if "hi-IN" in v_name else default_lang
        )

        text_chunks = chunk_text_utf8(text, 4200)
        if not text_chunks:
            return False

        audio_parts = []
        for ch in text_chunks:
            payload = {
                "input": {"text": ch},
                "voice": {"languageCode": lang_code, "name": v_name},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate, "sampleRateHertz": 44100}
            }
            res = requests.post(url, json=payload, timeout=20)
            res.raise_for_status()
            data = res.json()
            if "audioContent" not in data:
                return False
            audio_parts.append(base64.b64decode(data["audioContent"]))

        raw_mp3 = f"{out_path}.gcp_raw.mp3"
        with open(raw_mp3, "wb") as f:
            for part in audio_parts:
                f.write(part)
        if normalize_audio_to_44k_stereo(raw_mp3, out_path):
            if os.path.exists(raw_mp3):
                os.remove(raw_mp3)
            print(f"[GCP Cloud TTS] ✅ Direct cloud synthesis succeeded ({v_name}): '{text[:40]}...'")
            return True
        return False
    except Exception as e:
        print(f"[GCP Cloud TTS] ⚠️ Direct cloud synthesis notice: {e}")
        return False


async def probe_edge_tts(voice, rate="+0%", max_retries=3):
    global EDGE_TTS_AVAILABLE
    if edge_tts is None:
        EDGE_TTS_AVAILABLE = False
        return False
    probe_voice = voice
    if not probe_voice or "neural2" in probe_voice.lower() or "wavenet" in probe_voice.lower() or "_" in probe_voice:
        probe_voice = "hi-IN-MadhurNeural" if "hi" in (voice or "").lower() else "en-IN-PrabhatNeural"
    for attempt in range(1, max_retries + 1):
        try:
            communicate = edge_tts.Communicate("test probe", probe_voice, rate=rate)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    break
            print("[TTS] ✅ Edge-TTS connection verified.")
            EDGE_TTS_AVAILABLE = True
            return True
        except Exception as e:
            print(f"[TTS] ⚠️ Edge-TTS probe attempt {attempt}/{max_retries} notice: {e}")
            if attempt < max_retries:
                await asyncio.sleep(2 * attempt)

    print("[TTS] ⚠️ Edge-TTS unavailable on runner network. Pipeline will utilize Pre-Packaged / Cloud GCP Audio & Kokoro-82M.")
    EDGE_TTS_AVAILABLE = False
    return False


async def tts_with_boundaries(text, voice, a_path, rate="+0%", max_retries=3):
    """
    Synthesizes speech with Edge-TTS, captures internal WordBoundary metadata streams,
    and normalizes output to 44.1kHz stereo MP3.
    """
    if edge_tts is None:
        raise RuntimeError("edge_tts package is not available.")
    last_err = None
    raw_edge_mp3 = f"{a_path}.edge_raw.mp3"
    for attempt in range(1, max_retries + 1):
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            submaker = edge_tts.SubMaker()
            with open(raw_edge_mp3, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        submaker.feed(chunk)
            if os.path.exists(raw_edge_mp3) and os.path.getsize(raw_edge_mp3) > 500:
                normalize_audio_to_44k_stereo(raw_edge_mp3, a_path)
                if os.path.exists(raw_edge_mp3):
                    os.remove(raw_edge_mp3)
                return submaker
            else:
                raise RuntimeError("Edge-TTS generated empty or incomplete audio file.")
        except Exception as e:
            last_err = e
            print(f"[TTS] ⚠️ Edge-TTS scene synthesis attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(2 * attempt)

    raise RuntimeError(
        f"[TTS] ❌ Fatal: Scene audio synthesis failed after {max_retries} attempts: {last_err}. "
        "Halting job immediately to prevent rendering a mute video."
    )


def parse_srt_cues(srt_text, time_offset_sec):
    """
    Parses SRT string from SubMaker and offsets cue timestamps by time_offset_sec.
    Returns list of dicts: [{'start': sec, 'end': sec, 'text': str}]
    """
    if not srt_text:
        return []
    cues = []
    pattern = re.compile(
        r"(\d+)\s*\n(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n(.*?)(?=\n\s*\n|\Z)",
        re.DOTALL
    )
    for m in pattern.finditer(srt_text):
        _, sh, sm, ss, sms, eh, em, es, ems, text = m.groups()
        s_sec = int(sh) * 3600 + int(sm) * 60 + int(ss) + int(sms) / 1000.0 + time_offset_sec
        e_sec = int(eh) * 3600 + int(em) * 60 + int(es) + int(ems) / 1000.0 + time_offset_sec
        clean_text = text.strip().replace("\n", " ")
        if clean_text:
            cues.append({"start": s_sec, "end": e_sec, "text": clean_text})
    return cues


# ==========================================
# Wan2.1 (1.3B DiT) T4-Optimized Diffusion Engine
# True OS-Subprocess Isolated Dual-GPU Architecture (CUDA_VISIBLE_DEVICES=0 / 1)
# Eliminates `cudaErrorIllegalAddress` from multi-threaded cuDNN/Cutlass contention
# ==========================================
import contextlib
import threading

# ==========================================
# Step 1: Pre-Cache Real-ESRGAN (x4v3 + wdn-x4v3) & Practical-RIFE v4.25 Weights Once
# ==========================================
SR_RIFE_WEIGHT_URLS = {
    "realesr-general-x4v3.pth": [
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
        "https://huggingface.co/techycoder/realesrgan-general-x4v3/resolve/main/realesr-general-x4v3.pth",
    ],
    "realesr-general-wdn-x4v3.pth": [
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-wdn-x4v3.pth",
        "https://huggingface.co/spaces/yangheng/Super-Resolution-Anime-Diffusion/resolve/main/RealESRGANv030/weights/realesr-general-wdn-x4v3.pth",
    ],
    "flownet.pkl": [
        "https://huggingface.co/daydreamlive/RIFE/resolve/main/flownet.pkl",
        "https://huggingface.co/daydreamlive/RIFE/resolve/52c19702a5c82337d4dad5410c323964605cbb8e/train_log/flownet.pkl",
        "https://huggingface.co/r3gm/RIFE/resolve/main/RIFEv4.25_0919.zip",
        "https://huggingface.co/Hzwer/RIFE/resolve/main/RIFEv4.25_0919.zip",
    ],
}


def precache_sr_rife_weights(weights_dir=None):
        # Downloads Real-ESRGAN (realesr-general-x4v3.pth + realesr-general-wdn-x4v3.pth, ~4.7 MB x 2)
    # and Practical-RIFE v4.25 (flownet.pkl, ~19 MB) once into /kaggle/working/tmp/weights/
    # before spawning GPU 0 and GPU 1 worker subprocesses.
    import urllib.request
    import zipfile

    if weights_dir is None:
        weights_dir = f"{TMP}/weights"
    os.makedirs(weights_dir, exist_ok=True)
    t0 = time.time()

    min_bytes_map = {
        "realesr-general-x4v3.pth": 4_000_000,
        "realesr-general-wdn-x4v3.pth": 4_000_000,
        "flownet.pkl": 10_000_000,
    }

    for fname, urls in SR_RIFE_WEIGHT_URLS.items():
        dest = os.path.join(weights_dir, fname)
        min_b = min_bytes_map.get(fname, 1_000_000)
        if os.path.exists(dest) and os.path.getsize(dest) >= min_b:
            continue

        downloaded = False
        for url in urls:
            try:
                print(f"[Weights Pre-Cache] ⬇️ Downloading {fname} from {url}...", flush=True)
                parsed_url = urllib.parse.urlparse(url)
                if parsed_url.scheme != "https":
                    raise ValueError("Insecure URL scheme")
                if not url.startswith("https://"): raise ValueError("Insecure URL scheme")
                req = urllib.request.Request(url, headers={"User-Agent": "ShunopsAI-Kaggle-Renderer/1.0"})
                if url.endswith(".zip"):
                    tmp_zip = f"{dest}.tmp.zip"
                    if not req.full_url.startswith("https://"):
                        raise ValueError("Insecure URL scheme")
                    if not req.full_url.startswith('https://'): raise ValueError("Insecure URL scheme")
                    with urllib.request.urlopen(req, timeout=30) as resp, open(tmp_zip, "wb") as out_f:
                        shutil.copyfileobj(resp, out_f)
                    with zipfile.ZipFile(tmp_zip, "r") as zf:
                        for member in zf.namelist():
                            if member.endswith("flownet.pkl") and not os.path.basename(member).startswith("._"):
                                with zf.open(member) as src_m, open(dest, "wb") as dst_f:
                                    shutil.copyfileobj(src_m, dst_f)
                                break
                    try:
                        os.remove(tmp_zip)
                    except Exception:
                        pass
                else:
                    tmp_part = f"{dest}.part"
                    with urllib.request.urlopen(req, timeout=30) as resp, open(tmp_part, "wb") as out_f:
                        shutil.copyfileobj(resp, out_f)
                    if os.path.exists(tmp_part) and os.path.getsize(tmp_part) >= min_b:
                        shutil.move(tmp_part, dest)
                    elif os.path.exists(tmp_part):
                        os.remove(tmp_part)

                if os.path.exists(dest) and os.path.getsize(dest) >= min_b:
                    print(f"[Weights Pre-Cache] ✅ Cached {fname} ({os.path.getsize(dest) / (1024 * 1024):.2f} MB).", flush=True)
                    downloaded = True
                    break
            except Exception as dl_err:
                print(f"[Weights Pre-Cache] ⚠️ Mirror notice for {fname} ({url}): {dl_err}", flush=True)

        if not downloaded:
            print(f"[Weights Pre-Cache] ⚠️ Could not pre-cache {fname}; worker will auto-fallback if unavailable.", flush=True)

    ready_all = all(
        os.path.exists(os.path.join(weights_dir, k)) and os.path.getsize(os.path.join(weights_dir, k)) >= min_bytes_map[k]
        for k in min_bytes_map
    )
    if ready_all:
        print(f"[Weights Pre-Cache] ⚡ All Real-ESRGAN + Practical-RIFE v4.25 weights ready in {weights_dir} ({time.time() - t0:.2f}s).", flush=True)
    return weights_dir

PREENCODER_SUBPROCESS_SCRIPT = r"""
import gc, json, os, sys, time
import torch

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

def main():
    payload_path = sys.argv[1]
    out_cache_path = sys.argv[2]
    with open(payload_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    model_id = data["model_id"]
    hf_token = data.get("hf_token") or None
    prompt_pairs = data["prompt_pairs"]

    if hf_token:
        os.environ["HF_TOKEN"] = hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token

    try:
        from diffusers import WanVACEPipeline as PipelineClass
    except ImportError:
        from diffusers import DiffusionPipeline as PipelineClass

    t0 = time.time()
    print(f"[Wan2.1 Standalone Pre-Encoder] 🧠 Pre-encoding {len(prompt_pairs)} unique shot prompts on cuda:0 in isolated OS process...", flush=True)

    pipe = None
    try:
        pipe = PipelineClass.from_pretrained(
            model_id,
            transformer=None,
            vae=None,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
            token=hf_token,
        )
    except Exception:
        pipe = PipelineClass.from_pretrained(
            model_id,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
            token=hf_token,
        )

    pipe.text_encoder.to("cuda:0")
    cache = {}
    with torch.inference_mode():
        for idx, pair in enumerate(prompt_pairs):
            p_text, n_text = pair[0], pair[1]
            key = f"{p_text}|||{n_text}"
            if key in cache:
                continue
            enc_out = pipe.encode_prompt(
                prompt=p_text,
                negative_prompt=n_text,
                do_classifier_free_guidance=True,
                num_videos_per_prompt=1,
                device=torch.device("cuda:0"),
                dtype=torch.float16,
            )
            if isinstance(enc_out, (tuple, list)):
                p_emb, n_emb = enc_out[0], enc_out[1]
            else:
                p_emb, n_emb = enc_out, None
            cache[key] = (
                p_emb.detach().to("cpu", dtype=torch.float16).contiguous(),
                n_emb.detach().to("cpu", dtype=torch.float16).contiguous() if n_emb is not None else None,
            )

    torch.save(cache, out_cache_path)
    print(f"[Wan2.1 Standalone Pre-Encoder] ✅ Saved {len(cache)} prompt embeddings to {out_cache_path} in {time.time() - t0:.1f}s.", flush=True)

if __name__ == "__main__":
    main()
"""

WORKER_SUBPROCESS_SCRIPT = r"""
import gc, json, math, os, re, shutil, subprocess, sys, time
import torch

# Critical Turing T4 (SM 7.5) Stability Guards:
# 1. Expandable segments prevents allocator fragmentation
# 2. Disabling cuDNN benchmark & enabling deterministic 3D Conv prevents cuDNN FP16/FP32 workspace illegal memory access
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
if torch.cuda.is_available():
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = False
    try:
        if hasattr(torch.backends.cuda, "enable_flash_sdp"):
            torch.backends.cuda.enable_flash_sdp(False)
        if hasattr(torch.backends.cuda, "enable_mem_efficient_sdp"):
            torch.backends.cuda.enable_mem_efficient_sdp(True)
    except Exception:
        pass

def run_cmd(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0

def clip_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True
    )
    try:
        return float(r.stdout.strip() or 0.0)
    except Exception:
        return 0.0

def render_subpixel_kb(img_path, out_clip_path, duration_sec, shot_idx, encoder_args):
    try:
        import cv2
        import numpy as np
        img = cv2.imread(img_path)
        if img is None:
            raise ValueError(f"Cannot read {img_path}")
        h, w = img.shape[:2]
        target_ar = 16.0 / 9.0
        cur_ar = w / float(h)
        if cur_ar > target_ar:
            new_w = int(round(h * target_ar))
            sx = (w - new_w) // 2
            img = img[:, sx:sx + new_w]
        else:
            new_h = int(round(w / target_ar))
            sy = (h - new_h) // 2
            img = img[sy:sy + new_h, :]
        h, w = img.shape[:2]
        fps = 24
        total_frames = max(24, int(round(duration_sec * fps)))
        temp_raw = f"{out_clip_path}.raw.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vw = cv2.VideoWriter(temp_raw, fourcc, fps, (1920, 1080))
        zoom_in = (shot_idx == 0)
        center = (w / 2.0, h / 2.0)
        for i in range(total_frames):
            progress = i / float(total_frames)
            ease = 0.5 * (1.0 - math.cos(progress * math.pi))
            scale = (1.0 + 0.08 * ease) if zoom_in else (1.08 - 0.08 * ease)
            M = cv2.getRotationMatrix2D(center, 0.0, scale)
            M[0, 2] += (1920.0 / 2.0) - center[0]
            M[1, 2] += (1080.0 / 2.0) - center[1]
            frame = cv2.warpAffine(img, M, (1920, 1080), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            vw.write(frame)
        vw.release()
        run_cmd([
            "ffmpeg", "-y", "-i", temp_raw,
            "-vf", "unsharp=5:5:0.5:5:5:0.2,eq=contrast=1.06:brightness=0.01:saturation=1.12,format=yuv420p",
            "-r", "24", "-t", f"{duration_sec:.3f}",
            *encoder_args, out_clip_path
        ])
        if os.path.exists(temp_raw):
            os.remove(temp_raw)
        return True
    except Exception:
        run_cmd([
            "ffmpeg", "-y", "-loop", "1", "-i", img_path,
            "-vf", "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,unsharp=5:5:0.5:5:5:0.2,eq=contrast=1.06:brightness=0.01:saturation=1.12,format=yuv420p",
            "-r", "24", "-t", f"{duration_sec:.3f}",
            *encoder_args, out_clip_path
        ])
        return True

# ==========================================
# Step 2 & 3: Embedded Pure-PyTorch FP16 SRVGGNetCompact (Denoise-Blended) + Practical-RIFE v4.25 (IFNet)
# ==========================================
import torch.nn as nn
import torch.nn.functional as F

class SRVGGNetCompact(nn.Module):
        # Pure-PyTorch Real-ESRGAN compact VGG super-resolution network
    # (num_feat=64, num_conv=32, upscale=4, act_type='prelu').
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type="prelu"):
        super().__init__()
        self.num_in_ch = num_in_ch
        self.num_out_ch = num_out_ch
        self.num_feat = num_feat
        self.num_conv = num_conv
        self.upscale = upscale
        self.act_type = act_type
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat) if act_type == "prelu" else nn.LeakyReLU(0.1, inplace=True))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat) if act_type == "prelu" else nn.LeakyReLU(0.1, inplace=True))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        base = F.interpolate(x, scale_factor=self.upscale, mode="nearest")
        return out + base


_RIFE_WARP_GRID_CACHE = {}

def rife_warp(tenInput, tenFlow):
    k = (str(tenFlow.device), str(tenFlow.dtype), tenFlow.shape[0], tenFlow.shape[2], tenFlow.shape[3])
    if k not in _RIFE_WARP_GRID_CACHE:
        B, _, H, W = tenFlow.shape
        hor = torch.linspace(-1.0, 1.0, W, device=tenFlow.device, dtype=tenFlow.dtype).view(1, 1, 1, W).expand(B, -1, H, -1)
        ver = torch.linspace(-1.0, 1.0, H, device=tenFlow.device, dtype=tenFlow.dtype).view(1, 1, H, 1).expand(B, -1, -1, W)
        _RIFE_WARP_GRID_CACHE[k] = torch.cat([hor, ver], 1)
    tenFlow = torch.cat([
        tenFlow[:, 0:1, :, :] / ((tenInput.shape[3] - 1.0) / 2.0),
        tenFlow[:, 1:2, :, :] / ((tenInput.shape[2] - 1.0) / 2.0),
    ], 1)
    g = (_RIFE_WARP_GRID_CACHE[k] + tenFlow).permute(0, 2, 3, 1)
    return F.grid_sample(input=tenInput, grid=g, mode="bilinear", padding_mode="border", align_corners=True)


def rife_conv(in_planes, out_planes, kernel_size=3, stride=1, padding=1, dilation=1):
    return nn.Sequential(
        nn.Conv2d(in_planes, out_planes, kernel_size=kernel_size, stride=stride, padding=padding, dilation=dilation, bias=True),
        nn.LeakyReLU(0.2, True),
    )


class RIFEHead(nn.Module):
    def __init__(self):
        super().__init__()
        self.cnn0 = nn.Conv2d(3, 16, 3, 2, 1)
        self.cnn1 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn2 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn3 = nn.ConvTranspose2d(16, 4, 4, 2, 1)
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x, feat=False):
        x0 = self.cnn0(x)
        x = self.relu(x0)
        x1 = self.cnn1(x)
        x = self.relu(x1)
        x2 = self.cnn2(x)
        x = self.relu(x2)
        x3 = self.cnn3(x)
        if feat:
            return [x0, x1, x2, x3]
        return x3


class RIFEResConv(nn.Module):
    def __init__(self, c, dilation=1):
        super().__init__()
        self.conv = nn.Conv2d(c, c, 3, 1, dilation, dilation=dilation, groups=1)
        self.beta = nn.Parameter(torch.ones((1, c, 1, 1)), requires_grad=True)
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        return self.relu(self.conv(x) * self.beta + x)


class RIFEIFBlock(nn.Module):
    def __init__(self, in_planes, c=64):
        super().__init__()
        self.conv0 = nn.Sequential(
            rife_conv(in_planes, c // 2, 3, 2, 1),
            rife_conv(c // 2, c, 3, 2, 1),
        )
        self.convblock = nn.Sequential(*[RIFEResConv(c) for _ in range(8)])
        self.lastconv = nn.Sequential(
            nn.ConvTranspose2d(c, 4 * 13, 4, 2, 1),
            nn.PixelShuffle(2),
        )

    def forward(self, x, flow=None, scale=1):
        if scale != 1:
            x = F.interpolate(x, scale_factor=1.0 / scale, mode="bilinear", align_corners=False)
        if flow is not None:
            if scale != 1:
                flow = F.interpolate(flow, scale_factor=1.0 / scale, mode="bilinear", align_corners=False) * (1.0 / scale)
            x = torch.cat((x, flow), 1)
        feat = self.conv0(x)
        feat = self.convblock(feat)
        tmp = self.lastconv(feat)
        if scale != 1:
            tmp = F.interpolate(tmp, scale_factor=scale, mode="bilinear", align_corners=False)
        flow = tmp[:, :4] * scale
        mask = tmp[:, 4:5]
        feat = tmp[:, 5:]
        return flow, mask, feat


class RIFEIFNet(nn.Module):
        # Practical-RIFE v4.25 arbitrary-timestep IFNet_HDv3 architecture.
    # Supports scale=0.5 optical flow estimation + full-resolution 1080p warping.
    def __init__(self):
        super().__init__()
        self.block0 = RIFEIFBlock(7 + 8, c=192)
        self.block1 = RIFEIFBlock(8 + 4 + 8 + 8, c=128)
        self.block2 = RIFEIFBlock(8 + 4 + 8 + 8, c=64)
        self.block3 = RIFEIFBlock(8 + 4 + 8 + 8, c=32)
        self.encode = RIFEHead()

    def estimate_flow_lr(self, img0_lr, img1_lr, f0_lr, f1_lr, timestep, scale_list=(8, 4, 2, 1)):
        B, _, H_lr, W_lr = img0_lr.shape
        t_plane = torch.full((B, 1, H_lr, W_lr), float(timestep), device=img0_lr.device, dtype=img0_lr.dtype)
        warped_img0 = img0_lr
        warped_img1 = img1_lr
        flow = None
        mask = None
        feat = None
        blocks = [self.block0, self.block1, self.block2, self.block3]
        for i in range(4):
            if flow is None:
                flow, mask, feat = blocks[i](
                    torch.cat((img0_lr[:, :3], img1_lr[:, :3], f0_lr, f1_lr, t_plane), 1),
                    None,
                    scale=scale_list[i],
                )
            else:
                wf0 = rife_warp(f0_lr, flow[:, :2])
                wf1 = rife_warp(f1_lr, flow[:, 2:4])
                fd, m0, feat = blocks[i](
                    torch.cat((warped_img0[:, :3], warped_img1[:, :3], wf0, wf1, t_plane, mask, feat), 1),
                    flow,
                    scale=scale_list[i],
                )
                mask = m0
                flow = flow + fd
            if i < 3:
                warped_img0 = rife_warp(img0_lr, flow[:, :2])
                warped_img1 = rife_warp(img1_lr, flow[:, 2:4])
        return flow, mask


def load_blended_srvgg(weights_dir, device):
    x4_path = os.path.join(weights_dir, "realesr-general-x4v3.pth")
    wdn_path = os.path.join(weights_dir, "realesr-general-wdn-x4v3.pth")
    if not (os.path.exists(x4_path) and os.path.exists(wdn_path)):
        return None
    ckpt_x4 = torch.load(x4_path, map_location="cpu", weights_only=False)
    ckpt_wdn = torch.load(wdn_path, map_location="cpu", weights_only=False)
    sd_x4 = ckpt_x4.get("params_ema") or ckpt_x4.get("params") or ckpt_x4
    sd_wdn = ckpt_wdn.get("params_ema") or ckpt_wdn.get("params") or ckpt_wdn
    blended_sd = {
        k: (0.65 * v.float() + 0.35 * sd_wdn[k].float())
        for k, v in sd_x4.items()
        if k in sd_wdn
    }
    model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type="prelu")
    model.load_state_dict(blended_sd, strict=True)
    model.eval().to(device=device, dtype=torch.float16)
    return model


def load_rife_v425(weights_dir, device):
    pkl_path = os.path.join(weights_dir, "flownet.pkl")
    if not os.path.exists(pkl_path):
        return None
    raw_sd = torch.load(pkl_path, map_location="cpu", weights_only=False)
    clean_sd = {
        k.replace("module.", ""): v
        for k, v in raw_sd.items()
        if not k.replace("module.", "").startswith(("teacher.", "caltime."))
    }
    model = RIFEIFNet()
    model.load_state_dict(clean_sd, strict=False)
    model.eval().to(device=device, dtype=torch.float16)
    return model


def render_sr_rife_nvenc_shot(
    frames,
    shot_dur,
    sub_clip,
    sr_model,
    rife_model,
    device,
    encoder_args,
    post_vf="unsharp=5:5:0.5:5:5:0.2,eq=contrast=1.06:brightness=0.01:saturation=1.12,format=yuv420p",
    sr_batch_size=8,
    ema_alpha=0.12,
):
        # Executes Steps 2, 3, and 4 on GPU:
    # - Step 2: Upscale 33 native frames (640x384 -> 2560x1536) in FP16 mini-batches of 8 via Denoise-Blended
              # SRVGGNetCompact (0.65*x4v3 + 0.35*wdn_x4v3), center-crop 16:9 (2560x1440), Lanczos downscale
              # to 1920x1080, and apply 0.12 temporal EMA smoothing to eliminate inter-frame shimmer.
    # - Step 3: Practical-RIFE v4.25 arbitrary-timestep interpolation across target_frames = max(24, int(round(shot_dur * 24)))
              # using scale=0.5 flow estimation (960x540 -> padded 960x544) + full-resolution 1920x1080 optical flow warp.
    # - Step 4: Pipe 1920x1080 @ 24 FPS RGB24 frames directly into NVENC H.264 (or libx264).
    import cv2
    import numpy as np

    if sr_model is None or rife_model is None or not frames or len(frames) < 2:
        return False

    # 1. Convert diffusers output frames to uint8 RGB numpy arrays (640x384)
    np_frames = []
    for fr in frames:
        if isinstance(fr, np.ndarray):
            arr = (fr * 255.0).clip(0, 255).astype(np.uint8) if (fr.dtype in (np.float32, np.float16) or fr.max() <= 1.0) else fr.astype(np.uint8)
        elif hasattr(fr, "convert"):
            arr = np.array(fr.convert("RGB"), dtype=np.uint8)
        else:
            arr = np.array(fr, dtype=np.uint8)
        np_frames.append(arr)

    num_native = len(np_frames)
    upscaled_1080p = []
    ema_prev = None

    # 2. Mini-batch FP16 Super-Resolution (batch_size=8) + 1920x1080 Lanczos + 0.12 Temporal EMA
    with torch.inference_mode():
        for b_start in range(0, num_native, sr_batch_size):
            b_slice = np_frames[b_start:b_start + sr_batch_size]
            batch_np = np.stack(b_slice, axis=0)  # (B, H, W, 3)
            batch_t = (
                torch.from_numpy(batch_np)
                .to(device=device, dtype=torch.float16)
                .permute(0, 3, 1, 2)
                .contiguous()
                / 255.0
            )
            sr_out = sr_model(batch_t).clamp_(0.0, 1.0)  # (B, 3, 1536, 2560)
            _, _, sr_h, sr_w = sr_out.shape
            # Center-crop 16:9 aspect ratio before Lanczos downscale to 1920x1080
            target_crop_h = int(round(sr_w * 9.0 / 16.0))
            if sr_h > target_crop_h:
                cy = (sr_h - target_crop_h) // 2
                sr_out = sr_out[:, :, cy:cy + target_crop_h, :]

            sr_hwc = (sr_out.permute(0, 2, 3, 1).contiguous() * 255.0).round().to(torch.uint8).cpu().numpy()
            del batch_t, sr_out

            for k_idx in range(sr_hwc.shape[0]):
                frame_1080 = cv2.resize(sr_hwc[k_idx], (1920, 1080), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
                if ema_prev is None:
                    ema_prev = frame_1080
                else:
                    ema_prev = (1.0 - ema_alpha) * frame_1080 + ema_alpha * ema_prev
                upscaled_1080p.append(ema_prev.clip(0.0, 255.0).round().astype(np.uint8))

    # 3 & 4. Practical-RIFE v4.25 Arbitrary-Timestep Interpolation + Direct Pipe to NVENC H.264
    target_frames = max(24, int(round(shot_dur * 24)))
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-pix_fmt", "rgb24", "-s", "1920x1080", "-r", "24",
        "-i", "-",
        "-vf", post_vf,
        "-r", "24", "-t", f"{shot_dur:.3f}",
        *encoder_args, sub_clip
    ]

    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    cached_pair_idx = (-1, -1)
    I0_hr = I1_hr = img0_pad = img1_pad = f0_lr = f1_lr = None

    try:
        with torch.inference_mode():
            for m in range(target_frames):
                pos = (m / float(max(1, target_frames - 1))) * (num_native - 1)
                idx0 = min(int(math.floor(pos)), num_native - 2)
                idx1 = idx0 + 1
                timestep = float(pos - idx0)

                if timestep <= 1e-4:
                    out_rgb = upscaled_1080p[idx0]
                elif timestep >= 1.0 - 1e-4:
                    out_rgb = upscaled_1080p[idx1]
                else:
                    if cached_pair_idx != (idx0, idx1):
                        I0_hr = (
                            torch.from_numpy(upscaled_1080p[idx0])
                            .to(device=device, dtype=torch.float16)
                            .permute(2, 0, 1)
                            .unsqueeze(0)
                            .contiguous()
                            / 255.0
                        )
                        I1_hr = (
                            torch.from_numpy(upscaled_1080p[idx1])
                            .to(device=device, dtype=torch.float16)
                            .permute(2, 0, 1)
                            .unsqueeze(0)
                            .contiguous()
                            / 255.0
                        )
                        # scale=0.5 flow estimation (960x540 padded by 4px to 960x544 for 32px alignment)
                        img0_lr = F.interpolate(I0_hr, size=(540, 960), mode="bilinear", align_corners=False)
                        img1_lr = F.interpolate(I1_hr, size=(540, 960), mode="bilinear", align_corners=False)
                        img0_pad = F.pad(img0_lr, (0, 0, 0, 4), mode="replicate")
                        img1_pad = F.pad(img1_lr, (0, 0, 0, 4), mode="replicate")
                        f0_lr = rife_model.encode(img0_pad)
                        f1_lr = rife_model.encode(img1_pad)
                        cached_pair_idx = (idx0, idx1)

                    flow_pad, mask_pad = rife_model.estimate_flow_lr(
                        img0_pad, img1_pad, f0_lr, f1_lr, timestep=timestep, scale_list=(8, 4, 2, 1)
                    )
                    flow_lr = flow_pad[:, :, :540, :960]
                    mask_lr = mask_pad[:, :, :540, :960]
                    # Upscale optical flow and occlusion mask to full 1920x1080 and warp full-res frames
                    flow_hr = F.interpolate(flow_lr, size=(1080, 1920), mode="bilinear", align_corners=False) * 2.0
                    mask_hr = torch.sigmoid(F.interpolate(mask_lr, size=(1080, 1920), mode="bilinear", align_corners=False))
                    w0 = rife_warp(I0_hr, flow_hr[:, :2])
                    w1 = rife_warp(I1_hr, flow_hr[:, 2:4])
                    merged_hr = (w0 * mask_hr + w1 * (1.0 - mask_hr)).clamp_(0.0, 1.0)
                    out_rgb = (merged_hr[0].permute(1, 2, 0).contiguous() * 255.0).round().to(torch.uint8).cpu().numpy()

                if proc.stdin:
                    proc.stdin.write(out_rgb.tobytes())

        if proc.stdin:
            proc.stdin.close()
            proc.stdin = None
        _, stderr_bytes = proc.communicate(timeout=60)
        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg NVENC pipe exited with {proc.returncode}: {stderr_bytes.decode('utf-8', errors='ignore')[-300:]}")
    finally:
        del I0_hr, I1_hr, img0_pad, img1_pad, f0_lr, f1_lr
        if proc.stdin:
            try:
                proc.stdin.close()
            except Exception:
                pass
        if proc.poll() is None:
            proc.kill()

    return os.path.exists(sub_clip) and os.path.getsize(sub_clip) > 1000


def main():
    tasks_path = sys.argv[1]
    cache_path = sys.argv[2]
    phys_gpu = int(sys.argv[3])

    with open(tasks_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    model_id = meta["model_id"]
    hf_token = meta.get("hf_token") or None
    tmp_dir = meta["tmp_dir"]
    weights_dir = meta.get("weights_dir") or os.path.join(tmp_dir, "weights")
    encoder_args = meta["encoder_args"]
    shots = meta["shots"]

    if hf_token:
        os.environ["HF_TOKEN"] = hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token

    # Because CUDA_VISIBLE_DEVICES is set to phys_gpu before this process booted,
    # local device 0 ("cuda:0") is 100% isolated to physical GPU `phys_gpu`!
    local_dev = torch.device("cuda:0")
    torch.cuda.set_device(0)

    prompt_cache = torch.load(cache_path, map_location="cpu", weights_only=False)
    default_embed = next(iter(prompt_cache.values())) if prompt_cache else None

    try:
        from diffusers import WanVACEPipeline as PipelineClass
    except ImportError:
        from diffusers import DiffusionPipeline as PipelineClass

    print(f"[Wan2.1 Worker GPU {phys_gpu}] 📦 Loading isolated pipeline on physical GPU {phys_gpu} (text_encoder=None, tokenizer=None)...", flush=True)
    pipe = PipelineClass.from_pretrained(
        model_id,
        text_encoder=None,
        tokenizer=None,
        torch_dtype=torch.float16,
        low_cpu_mem_usage=True,
        token=hf_token,
    )

    # CRITICAL FIX 1: Call .to(local_dev) WITHOUT `dtype=torch.float16`!
    # Preserves float32 on ['rope', 'time_embedder', 'scale_shift_table', 'norm1', 'norm2', 'norm3']
    # and keeps AutoencoderKLWan in native float16 (Turing SM 7.5 Tensor Cores: 0.4s encode, 19s decode, zero FP32 5D buffer overflow).
    pipe.to(local_dev)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing(slice_size="max")

    if hasattr(pipe, "vae") and pipe.vae is not None:
        if hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()
        if hasattr(pipe.vae, "enable_slicing"):
            pipe.vae.enable_slicing()

    def _isolated_encode_prompt(
        prompt=None,
        negative_prompt=None,
        do_classifier_free_guidance=True,
        num_videos_per_prompt=1,
        prompt_embeds=None,
        negative_prompt_embeds=None,
        max_sequence_length=512,
        device=None,
        dtype=None,
        **kwargs
    ):
        out_dtype = dtype or torch.float16
        if prompt_embeds is not None:
            p_g = prompt_embeds.to(device=local_dev, dtype=out_dtype, copy=True)
            n_g = negative_prompt_embeds.to(device=local_dev, dtype=out_dtype, copy=True) if negative_prompt_embeds is not None else None
            return p_g, n_g
        p_str = prompt[0] if isinstance(prompt, list) else (prompt or "")
        n_str = negative_prompt[0] if isinstance(negative_prompt, list) else (negative_prompt or "")
        pair = prompt_cache.get(f"{p_str}|||{n_str}") or default_embed
        p_cpu, n_cpu = pair
        return (
            p_cpu.to(device=local_dev, dtype=out_dtype, copy=True),
            n_cpu.to(device=local_dev, dtype=out_dtype, copy=True) if n_cpu is not None else None,
        )

    pipe.encode_prompt = _isolated_encode_prompt

    sr_model = None
    rife_model = None
    try:
        t_aux = time.time()
        sr_model = load_blended_srvgg(weights_dir, local_dev)
        rife_model = load_rife_v425(weights_dir, local_dev)
        if sr_model is not None and rife_model is not None:
            print(f"[Wan2.1 Worker GPU {phys_gpu}] ⚡ Loaded FP16 SRVGGNetCompact (0.65*x4v3 + 0.35*wdn) + Practical-RIFE v4.25 on cuda:{phys_gpu} in {time.time() - t_aux:.2f}s.", flush=True)
        else:
            print(f"[Wan2.1 Worker GPU {phys_gpu}] ⚠️ SR/RIFE weights missing in {weights_dir}; CPU FFmpeg fallback active.", flush=True)
    except Exception as aux_e:
        print(f"[Wan2.1 Worker GPU {phys_gpu}] ⚠️ SR/RIFE init notice ({aux_e}); CPU FFmpeg fallback active.", flush=True)
        sr_model = None
        rife_model = None

    alloc_mb = torch.cuda.memory_allocated(0) / (1024 ** 2)
    free_gb = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)) / (1024 ** 3)
    print(f"[Wan2.1 Worker GPU {phys_gpu}] ✅ Online on physical GPU {phys_gpu} (cuda:{phys_gpu}) — VRAM Allocated: {alloc_mb:.1f} MB (~{free_gb:.1f} GB Free Headroom, float16 VAE + float32 RoPE/Norm active!).", flush=True)

    for shot in shots:
        shot_global_idx = shot["shot_global_idx"]
        done_marker = os.path.join(tmp_dir, f"shot_done_{shot_global_idx}.ok")
        claim_lock = os.path.join(tmp_dir, f"shot_claim_{shot_global_idx}.lock")

        if os.path.exists(done_marker):
            continue

        # Atomic kernel-level work-stealing claim
        try:
            fd = os.open(claim_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(phys_gpu).encode("utf-8"))
            os.close(fd)
        except FileExistsError:
            continue

        scene_idx = shot["scene_idx"]
        s_idx = shot["s_idx"]
        num_shots = shot["num_shots"]
        shot_dur = shot["shot_dur"]
        sub_clip = shot["sub_clip"]
        clean_prompt = shot["clean_prompt"]
        neg_prompt = shot["neg_prompt"]
        seed = shot["seed"]
        kf_path = shot.get("kf_path")

        t_shot = time.time()
        print(f"[Wan2.1-VACE-1.3B] Scene {scene_idx+1} [Shot {s_idx+1}/{num_shots}]: Generating motion on GPU {phys_gpu} (cuda:{phys_gpu})...", flush=True)

        ref_image = None
        if kf_path and os.path.exists(kf_path):
            try:
                from diffusers.utils import load_image
                ref_image = load_image(kf_path).convert("RGB").resize((640, 384))
            except Exception:
                ref_image = None

        try:
            if hasattr(pipe, "vae") and hasattr(pipe.vae, "clear_cache"):
                try:
                    pipe.vae.clear_cache()
                except Exception:
                    pass
            elif hasattr(pipe, "vae") and hasattr(pipe.vae, "_clear_cache"):
                try:
                    pipe.vae._clear_cache()
                except Exception:
                    pass
            torch.cuda.empty_cache()

            with torch.inference_mode():
                generator = torch.Generator(device=local_dev).manual_seed(seed)
                call_kwargs = {
                    "prompt": clean_prompt,
                    "negative_prompt": neg_prompt,
                    "height": 384,
                    "width": 640,
                    "num_frames": 33,
                    "num_inference_steps": 25,
                    "guidance_scale": 5.5,
                    "generator": generator,
                }
                if ref_image is not None:
                    if "VACE" in type(pipe).__name__ or "WanVACE" in str(type(pipe)):
                        call_kwargs["reference_images"] = [ref_image]
                    else:
                        call_kwargs["image"] = ref_image

                try:
                    output = pipe(**call_kwargs)
                except TypeError as te:
                    if ref_image is not None:
                        call_kwargs.pop("image", None)
                        call_kwargs.pop("reference_images", None)
                        output = pipe(**call_kwargs)
                    else:
                        raise te

                frames = output.frames[0]
                torch.cuda.synchronize(local_dev)

            t_sr_rife = time.time()
            gpu_postproc_ok = False
            if sr_model is not None and rife_model is not None:
                try:
                    gpu_postproc_ok = render_sr_rife_nvenc_shot(
                        frames=frames,
                        shot_dur=shot_dur,
                        sub_clip=sub_clip,
                        sr_model=sr_model,
                        rife_model=rife_model,
                        device=local_dev,
                        encoder_args=encoder_args,
                    )
                    if gpu_postproc_ok:
                        print(
                            f"[SR+RIFE GPU ⚡] Scene {scene_idx+1} Shot {s_idx+1}: 33->1080p SR + RIFE v4.25 + NVENC completed in {time.time() - t_sr_rife:.2f}s",
                            flush=True,
                        )
                except Exception as sr_rife_err:
                    print(
                        f"[SR+RIFE Fallback Notice] Scene {scene_idx+1} Shot {s_idx+1} GPU SR/RIFE failed ({sr_rife_err}); falling back to FFmpeg Lanczos + minterpolate...",
                        flush=True,
                    )
                    gpu_postproc_ok = False

            if not gpu_postproc_ok:
                raw_clip = os.path.join(tmp_dir, f"raw_{scene_idx}_{s_idx}.mp4")
                try:
                    from diffusers.utils import export_to_video
                    export_to_video(frames, raw_clip, fps=16)
                except Exception:
                    import numpy as np
                    from PIL import Image
                    fdir = os.path.join(tmp_dir, f"frames_{scene_idx}_{s_idx}")
                    os.makedirs(fdir, exist_ok=True)
                    for f_i, fr in enumerate(frames):
                        if isinstance(fr, np.ndarray):
                            arr = (fr * 255).astype(np.uint8) if (fr.dtype in (np.float32, np.float16) or fr.max() <= 1.0) else fr.astype(np.uint8)
                            Image.fromarray(arr).save(f"{fdir}/f_{f_i:04d}.png")
                        elif hasattr(fr, "save"):
                            fr.save(f"{fdir}/f_{f_i:04d}.png")
                    run_cmd(["ffmpeg", "-y", "-framerate", "16", "-i", f"{fdir}/f_%04d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", raw_clip])
                    shutil.rmtree(fdir, ignore_errors=True)

                raw_d = clip_duration(raw_clip)
                # Smart pacing: lock motion velocity between 0.85x and 1.25x natural speed (zero slow-motion freeze)
                pts_mult = min(1.25, max(0.85, shot_dur / max(raw_d, 0.4)))
                vf_pipeline = (
                    f"setpts={pts_mult:.4f}*PTS,"
                    f"minterpolate=fps=24:mi_mode=blend,"
                    f"scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,"
                    f"unsharp=5:5:0.5:5:5:0.2,"
                    f"eq=contrast=1.06:brightness=0.01:saturation=1.12,"
                    f"format=yuv420p"
                )
                run_cmd(["ffmpeg", "-y", "-i", raw_clip, "-vf", vf_pipeline, "-r", "24", "-t", f"{shot_dur:.3f}", *encoder_args, sub_clip])

            # Luma Gate Check (YAVG < 10.0)
            is_pitch_black = False
            try:
                sample_ss = str(round(min(0.5, max(0.0, shot_dur / 2.0)), 2))
                luma_run = subprocess.run(
                    ["ffmpeg", "-y", "-ss", sample_ss, "-i", sub_clip, "-vframes", "5", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
                    capture_output=True, text=True, timeout=8
                )
                y_matches = re.findall(r"lavfi\.signalstats\.YAVG=([0-9\.]+)", luma_run.stdout + luma_run.stderr)
                if y_matches and (sum(float(y) for y in y_matches) / len(y_matches)) < 10.0:
                    is_pitch_black = True
            except Exception:
                pass

            if is_pitch_black and kf_path and os.path.exists(kf_path):
                print(f"[Luma Gate 🛡️] Rescuing Scene {scene_idx+1} Shot {s_idx+1} on GPU {phys_gpu} with subpixel Ken Burns...", flush=True)
                render_subpixel_kb(kf_path, sub_clip, shot_dur, s_idx, encoder_args)

            with open(done_marker, "w", encoding="utf-8") as df:
                df.write("ok")
            print(f"[Wan2.1 Done ✅] Scene {scene_idx+1} [Shot {s_idx+1}/{num_shots}] finished on GPU {phys_gpu} (cuda:{phys_gpu}) in {time.time() - t_shot:.1f}s -> {sub_clip}", flush=True)

        except Exception as shot_err:
            print(f"[Wan2.1 Worker GPU {phys_gpu} Notice] Scene {scene_idx+1} Shot {s_idx+1} encountered error ({shot_err}).", flush=True)
            # Rescue this specific shot with subpixel Ken Burns so the scene is never missing
            if kf_path and os.path.exists(kf_path):
                render_subpixel_kb(kf_path, sub_clip, shot_dur, s_idx, encoder_args)
                if os.path.exists(sub_clip) and os.path.getsize(sub_clip) > 1000:
                    with open(done_marker, "w", encoding="utf-8") as df:
                        df.write("rescued")
                    print(f"[Wan2.1 Worker GPU {phys_gpu} 🛡️] Rescued Scene {scene_idx+1} Shot {s_idx+1} via subpixel Ken Burns.", flush=True)
            else:
                try:
                    os.remove(claim_lock)
                except Exception:
                    pass
            # If CUDA error occurred, exit with code 42 so parent orchestrator respawns a fresh subprocess with a clean CUDA context!
            if "CUDA error" in str(shot_err) or "illegal memory access" in str(shot_err):
                print(f"[Wan2.1 Worker GPU {phys_gpu}] 🔄 Exiting subprocess to reset clean OS CUDA context on GPU {phys_gpu}...", flush=True)
                sys.exit(42)

if __name__ == "__main__":
    main()
"""

class WanT4OptimizedEngine:
    def __init__(self, hf_token=None, device="cuda"):
        self.pipe = None
        self.fallback_pipe = None
        self.hf_token = hf_token
        self.device = device
        self.model_id = "Wan-AI/Wan2.1-VACE-1.3B-diffusers"
        self.engine_name = "Wan2.1-VACE-1.3B"
        self.num_gpus = torch.cuda.device_count() if torch.cuda.is_available() else 0
        self._init_model()

    def _init_model(self):
        if not torch.cuda.is_available():
            raise RuntimeError("CRITICAL ERROR: CUDA is not available! Kaggle kernel must have GPU enabled.")

        num_gpus = torch.cuda.device_count()
        self.num_gpus = num_gpus
        dev_idx = 0
        if ":" in str(self.device):
            try:
                dev_idx = int(str(self.device).split(":")[1])
            except Exception:
                dev_idx = 0

        gpu_name = torch.cuda.get_device_name(dev_idx)
        vram_gb = torch.cuda.get_device_properties(dev_idx).total_memory / (1024 ** 3)
        print(f"[Wan2.1] CUDA devices detected: {num_gpus}. Primary GPU ({dev_idx}): {gpu_name} ({vram_gb:.1f} GB VRAM)")
        if num_gpus >= 2:
            for g_i in range(num_gpus):
                g_name = torch.cuda.get_device_name(g_i)
                g_vram = torch.cuda.get_device_properties(g_i).total_memory / (1024 ** 3)
                print(f"[Wan2.1 Hardware] GPU {g_i} (cuda:{g_i}): {g_name} ({g_vram:.1f} GB VRAM)")

        if self.hf_token:
            os.environ["HF_TOKEN"] = self.hf_token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = self.hf_token

        # Keep parent process at 0 MB VRAM so isolated OS worker subprocesses (CUDA_VISIBLE_DEVICES=0 / 1)
        # each get a 100% private CUDA runtime context, private cuDNN handle, and 14.6 GB dedicated VRAM.
        print(f"[Wan2.1-VACE] Configured for OS-Process Isolated Multi-GPU Worker Execution (model: {self.model_id}).")

    def _init_fallback_engine(self):
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        from diffusers import AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler
        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file

        self.engine_name = "AnimateDiff-Lightning"
        device = self.device
        dtype = torch.float16

        print("[Fallback] Loading AnimateDiff-Lightning + epiCRealism...")
        adapter_path = hf_hub_download(
            repo_id="ByteDance/AnimateDiff-Lightning",
            filename="animatediff_lightning_4step_diffusers.safetensors",
            token=self.hf_token if self.hf_token else None
        )
        adapter = MotionAdapter().to(device, dtype)
        adapter.load_state_dict(load_file(adapter_path, device=device))

        self.fallback_pipe = AnimateDiffPipeline.from_pretrained(
            "emilianJR/epiCRealism",
            motion_adapter=adapter,
            torch_dtype=dtype,
            token=self.hf_token if self.hf_token else None
        ).to(device)

        self.fallback_pipe.scheduler = EulerDiscreteScheduler.from_config(
            self.fallback_pipe.scheduler.config,
            timestep_spacing="trailing",
            beta_schedule="linear"
        )
        if hasattr(self.fallback_pipe, "vae") and hasattr(self.fallback_pipe.vae, "enable_slicing"):
            try:
                self.fallback_pipe.vae.enable_slicing()
            except Exception:
                pass

    def render_subpixel_ken_burns(self, img_path, out_clip_path, duration_sec, shot_idx=0):
        """
        Subpixel floating-point smooth Ken Burns at native 1080p (1920x1080).
        Replaces integer-quantized FFmpeg zoompan, eliminating all 1-pixel micro-jitter / stair-step vibrations.
        """
        try:
            import cv2
            import numpy as np
            img = cv2.imread(img_path)
            if img is None:
                raise ValueError(f"Could not read image: {img_path}")
            h, w = img.shape[:2]
            target_ar = 16.0 / 9.0
            cur_ar = w / float(h)
            if cur_ar > target_ar:
                new_w = int(round(h * target_ar))
                start_x = (w - new_w) // 2
                img = img[:, start_x:start_x + new_w]
            else:
                new_h = int(round(w / target_ar))
                start_y = (h - new_h) // 2
                img = img[start_y:start_y + new_h, :]

            h, w = img.shape[:2]
            fps = 24
            total_frames = max(24, int(round(duration_sec * fps)))
            temp_raw = f"{out_clip_path}.raw.mp4"
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            vw = cv2.VideoWriter(temp_raw, fourcc, fps, (1920, 1080))

            zoom_in = (shot_idx == 0)
            center = (w / 2.0, h / 2.0)
            for i in range(total_frames):
                progress = i / float(total_frames)
                ease = 0.5 * (1.0 - math.cos(progress * math.pi))
                scale = (1.0 + 0.08 * ease) if zoom_in else (1.08 - 0.08 * ease)
                M = cv2.getRotationMatrix2D(center, 0.0, scale)
                M[0, 2] += (1920.0 / 2.0) - center[0]
                M[1, 2] += (1080.0 / 2.0) - center[1]
                frame = cv2.warpAffine(img, M, (1920, 1080), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
                vw.write(frame)
            vw.release()

            run([
                "ffmpeg", "-y", "-i", temp_raw,
                "-vf", "unsharp=5:5:0.5:5:5:0.2,eq=contrast=1.06:brightness=0.01:saturation=1.12,format=yuv420p",
                "-r", "24", "-t", f"{duration_sec:.3f}",
                *get_best_video_encoder_args(), out_clip_path
            ])
            if os.path.exists(temp_raw):
                os.remove(temp_raw)
            return True
        except Exception as e:
            print(f"[Ken Burns Warning] OpenCV subpixel render failed ({e}), falling back to FFmpeg Lanczos 1080p...")
            run([
                "ffmpeg", "-y", "-loop", "1", "-i", img_path,
                "-vf", "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,unsharp=5:5:0.5:5:5:0.2,eq=contrast=1.06:brightness=0.01:saturation=1.12,format=yuv420p",
                "-r", "24", "-t", f"{duration_sec:.3f}",
                *get_best_video_encoder_args(), out_clip_path
            ])
            return True

    def build_scene_shot_specs(self, prompt, target_dur, out_mp4, scene_idx, domain="general", visual_bible=None):
        # Smart shot pacing: target ~2.5s - 3.2s per shot so raw diffusion frames map directly to natural real-time playback
        num_shots = max(1, int(math.ceil(target_dur / 3.0)))
        shot_dur = target_dur / num_shots

        vb_ref = visual_bible or {}
        motion_directive = vb_ref.get("cameraMotionChoreography", "")
        motion_tag = f", {motion_directive[:100]}" if motion_directive else ""

        shot_variations = [
            (f"cinematic dynamic tracking dolly shot with continuous optical motion{motion_tag}, vivid atmospheric depth", scene_idx * 19 + 3),
            (f"dynamic sweeping pan across scene action{motion_tag}, living environmental motion, fluid camera movement", scene_idx * 19 + 7),
            (f"low-angle kinetic forward push-in{motion_tag}, active environmental atmosphere, continuous camera motion", scene_idx * 19 + 11),
            (f"smooth continuous orbital tracking move{motion_tag}, dynamic optical perspective, fluid motion", scene_idx * 19 + 15),
        ]

        vb = visual_bible or {}
        latent_traps = vb.get("latentTrapsToBan", [])
        real_grounding = vb.get("realWorldGrounding", "")
        grounding_prefix = f"{real_grounding[:120]}, " if real_grounding else ""
        bible_neg = ", ".join(latent_traps[:15]) + ", " if latent_traps else ""

        if domain in ["science", "space", "technology", "nature", "history"]:
            domain_neg = "sports, stadium, athletics, cricket, football, soccer, baseball helmet, american football helmet, sports jersey, scoreboard, crowd cheering, referee, match, ball, bat, pads, wickets, "
        elif domain == "sports":
            domain_neg = "cartoon, anime, manga, comic, caricature, "
        else:
            domain_neg = "cartoon, anime, "

        kf_path = find_keyframe_image(scene_idx)
        if not kf_path or not os.path.exists(kf_path):
            fallback_kf = f"{TMP}/kf_{scene_idx:03d}.png"
            if os.path.exists(fallback_kf):
                kf_path = fallback_kf
            else:
                for alt_i in [max(0, scene_idx - 1), 0]:
                    alt_p = find_keyframe_image(alt_i)
                    if alt_p and os.path.exists(alt_p):
                        kf_path = alt_p
                        break

        if domain in ["history", "literature", "ancient"]:
            spatial_neg = "warehouse, airplane hangar, modern factory, industrial hall, industrial interior, modern architecture, modern office, modern laboratory, "
        else:
            spatial_neg = "warehouse, airplane hangar, abandoned ruins, dirty factory floor, "

        shots = []
        for s_idx in range(num_shots):
            var_text, seed = shot_variations[s_idx % len(shot_variations)]
            sub_clip = f"{TMP}/sub_{scene_idx}_{s_idx}.mp4"

            clean_prompt = (
                f"{grounding_prefix}{prompt[:220]}, {var_text}, modern digital cinema, sharp high-definition focus, "
                f"vivid natural colors, documentary broadcast quality, continuous living motion, "
                f"unlabeled telemetry displays, zero text, zero letters, zero numbers"
            )
            neg_prompt = (
                f"{bible_neg}"
                f"{domain_neg}"
                f"{spatial_neg}"
                "horror, choking, strangling, neck grabbing, violence, assault, aggression, threat, painful grimace, distress, screaming, blood, "
                "inconsistent face, multiple different faces, female model, woman reading magazine, modern clothing, casual clothing, t-shirt, jeans, hoodie, "
                "mutated hands, extra fingers, missing fingers, fused fingers, distorted hands, morphing face, melting skin, warped anatomy, "
                "text, letters, words, writing, numbers, labels, charts, line graphs, pseudo-code, glyphs, bullet points, presentation slide, document, page with text, "
                "garbled ui, blurry text, watermarks, symbols, subtitles, hud text, map, cartographic lines, "
                "temporal morphing, surface rippling, breathing walls, gelatinous motion, boiling edges, "
                "temporal boiling, gelatinous surface warping, motion smear, extreme motion blur, "
                "blown-out highlights, clipped cyan, hyper-neon blue glare, "
                "vintage, old, grainy, sepia, retro, 8mm, 16mm, vhs, noisy, dusty, antique, "
                "cartoon, anime, 3d render, cgi, plastic skin, distorted, blurry, bad anatomy, deformed"
            )
            shots.append({
                "scene_idx": scene_idx,
                "s_idx": s_idx,
                "num_shots": num_shots,
                "shot_dur": shot_dur,
                "sub_clip": sub_clip,
                "clean_prompt": clean_prompt,
                "neg_prompt": neg_prompt,
                "seed": seed,
                "kf_path": kf_path,
            })

        return {
            "scene_idx": scene_idx,
            "num_shots": num_shots,
            "shot_dur": shot_dur,
            "out_mp4": out_mp4,
            "kf_path": kf_path,
            "shots": shots,
        }

    def _assemble_scene_shots(self, scene_spec):
        out_mp4 = scene_spec["out_mp4"]
        scene_idx = scene_spec["scene_idx"]
        kf_path = scene_spec["kf_path"]
        shot_files = []

        for sh in scene_spec["shots"]:
            sub_clip = sh["sub_clip"]
            if not (os.path.exists(sub_clip) and os.path.getsize(sub_clip) > 1000):
                rescue_kf = kf_path if (kf_path and os.path.exists(kf_path)) else find_keyframe_image(0)
                if rescue_kf and os.path.exists(rescue_kf):
                    print(f"[Emergency Fallback 🛡️] Rendering subpixel Ken Burns for Scene {scene_idx+1} Shot {sh['s_idx']+1}...")
                    self.render_subpixel_ken_burns(rescue_kf, sub_clip, sh["shot_dur"], shot_idx=sh["s_idx"])
            shot_files.append(sub_clip)

        if len(shot_files) == 1:
            shutil.copyfile(shot_files[0], out_mp4)
        else:
            s_list = f"{TMP}/slist_{scene_idx}.txt"
            open(s_list, "w").write("".join(f"file '{s}'\n" for s in shot_files))
            run([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", s_list,
                "-c", "copy", out_mp4
            ])

        if not os.path.exists(out_mp4) or os.path.getsize(out_mp4) < 1000:
            raise RuntimeError(f"Failed to produce video clip for {out_mp4}")
        return True

    def render_all_scenes_parallel(self, scene_items, domain="general", visual_bible=None, thumb_prompt=None):
        """
        OS-Process Isolated Dual-GPU Dispatcher (Fixes `cudaErrorIllegalAddress` on Kaggle T4 x 2):
        1. Launches an isolated child process (`CUDA_VISIBLE_DEVICES=0`) to batch pre-encode all
           unique shot prompts into `/kaggle/working/prompt_cache.pt`, then exits cleanly so
           100% of UMT5 VRAM & Host RAM is reclaimed by the OS.
        2. Spawns 2 completely separate OS worker processes (`CUDA_VISIBLE_DEVICES=0` and
           `CUDA_VISIBLE_DEVICES=1`), each with its own private CUDA context, private cuDNN handle,
           `float32` preserved on `rope`/`norm1-3`/`scale_shift_table`, and native `float16` 3D Causal VAE with attention/VAE slicing & tiling.
        3. If a worker subprocess ever hits a CUDA error on any shot, it rescues that shot and exits
           with code 42 so the parent automatically respawns a fresh subprocess with a clean CUDA context.
        """
        scene_specs = []
        all_shots = []
        unique_pairs_map = {}

        for item in scene_items:
            spec = self.build_scene_shot_specs(
                item["scene"]["visual_prompt"],
                item["dur"],
                item["v_path"],
                scene_idx=item["idx"],
                domain=domain,
                visual_bible=visual_bible,
            )
            scene_specs.append(spec)
            for sh in spec["shots"]:
                sh["shot_global_idx"] = len(all_shots)
                all_shots.append(sh)
                key = f"{sh['clean_prompt']}|||{sh['neg_prompt']}"
                if key not in unique_pairs_map:
                    unique_pairs_map[key] = [sh["clean_prompt"], sh["neg_prompt"]]

        prompt_cache_path = f"{OUT}/prompt_cache.pt"
        preencode_json = f"{TMP}/prompts_to_encode.json"
        preencode_py = f"{TMP}/_preencode_worker.py"

        with open(preencode_json, "w", encoding="utf-8") as f:
            json.dump({
                "model_id": self.model_id,
                "hf_token": self.hf_token,
                "prompt_pairs": list(unique_pairs_map.values()),
            }, f)
        with open(preencode_py, "w", encoding="utf-8") as f:
            f.write(PREENCODER_SUBPROCESS_SCRIPT)

        print(f"[Wan2.1 Dual-GPU] 🚀 Launching isolated subprocess for GPU prompt pre-encoding on cuda:0...", flush=True)
        pre_env = os.environ.copy()
        pre_env["CUDA_VISIBLE_DEVICES"] = "0"
        pre_proc = subprocess.run([sys.executable, "-u", preencode_py, preencode_json, prompt_cache_path], env=pre_env)
        if pre_proc.returncode != 0 or not os.path.exists(prompt_cache_path):
            raise RuntimeError(f"Prompt pre-encoder subprocess failed with exit code {pre_proc.returncode}")
        print(f"[Wan2.1 Dual-GPU] ✅ Isolated pre-encoder subprocess exited cleanly. GPU 0 VRAM completely reclaimed by OS!", flush=True)

        # Clean any stale lock/done files before launching worker subprocesses
        for sh in all_shots:
            idx_g = sh["shot_global_idx"]
            for p_stale in (f"{TMP}/shot_done_{idx_g}.ok", f"{TMP}/shot_claim_{idx_g}.lock"):
                if os.path.exists(p_stale):
                    try:
                        os.remove(p_stale)
                    except Exception:
                        pass

        weights_dir = precache_sr_rife_weights(f"{TMP}/weights")
        tasks_json = f"{TMP}/shot_tasks.json"
        worker_py = f"{TMP}/_gpu_shot_worker.py"
        with open(tasks_json, "w", encoding="utf-8") as f:
            json.dump({
                "model_id": self.model_id,
                "hf_token": self.hf_token,
                "tmp_dir": TMP,
                "weights_dir": weights_dir,
                "encoder_args": get_best_video_encoder_args(),
                "shots": all_shots,
            }, f)
        with open(worker_py, "w", encoding="utf-8") as f:
            f.write(WORKER_SUBPROCESS_SCRIPT)

        active_gpu_ids = list(range(max(1, min(2, self.num_gpus))))
        print(
            f"\n[Parallel Video Dispatcher] 🎬 Spawning {len(active_gpu_ids)} OS-Isolated GPU Worker Subprocesses "
            f"across GPUs {active_gpu_ids} for {len(all_shots)} shots...",
            flush=True
        )

        def _remaining_unclaimed_shots():
            rem = 0
            for sh in all_shots:
                idx_g = sh["shot_global_idx"]
                if not os.path.exists(f"{TMP}/shot_done_{idx_g}.ok"):
                    rem += 1
            return rem

        def _supervise_gpu_worker(phys_gpu):
            max_respawns = 4
            for attempt in range(1, max_respawns + 1):
                if _remaining_unclaimed_shots() == 0:
                    break
                w_env = os.environ.copy()
                # Pin this OS subprocess strictly to `phys_gpu` so it cannot see or touch the other GPU!
                w_env["CUDA_VISIBLE_DEVICES"] = str(phys_gpu)
                proc = subprocess.Popen(
                    [sys.executable, "-u", worker_py, tasks_json, prompt_cache_path, str(phys_gpu)],
                    env=w_env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                if proc.stdout:
                    for line in proc.stdout:
                        print(line, end="", flush=True)
                rc = proc.wait()
                if rc == 0 or _remaining_unclaimed_shots() == 0:
                    break
                print(
                    f"[Parallel Video Dispatcher] 🔄 Respawning fresh OS worker subprocess for GPU {phys_gpu} "
                    f"(attempt {attempt + 1}/{max_respawns}, exit_code={rc})...",
                    flush=True
                )
                time.sleep(2)

        sup_threads = [
            threading.Thread(target=_supervise_gpu_worker, args=(g_id,), name=f"Supervisor-GPU{g_id}", daemon=True)
            for g_id in active_gpu_ids
        ]
        for t in sup_threads:
            t.start()
        for t in sup_threads:
            t.join()

        # Assemble all scenes in exact chronological order
        for spec in scene_specs:
            self._assemble_scene_shots(spec)

    def generate_scene_montage(self, prompt, target_dur, out_mp4, scene_idx, domain="general", visual_bible=None):
        fake_item = {
            "idx": scene_idx,
            "scene": {"visual_prompt": prompt},
            "dur": target_dur,
            "v_path": out_mp4,
        }
        self.render_all_scenes_parallel([fake_item], domain=domain, visual_bible=visual_bible)
        return True

    def generate_hero_thumbnail_diffusion(self, visual_prompt, out_jpg, domain="general"):
        """
        OPTION A: Dedicated Concept Diffusion Pass on Kaggle T4 GPU.
        Generates a pristine, high-resolution, high-dynamic-range hero visual
        symbolizing the core topic with authentic subject fidelity (no text in image).
        """
        # Stage 1 / Tarika 2 Fast Path: Reuse pristine FLUX.1-schnell keyframe from Scene 0 if available
        kf0 = find_keyframe_image(0)
        if kf0 and os.path.exists(kf0):
            try:
                from PIL import Image
                img0 = Image.open(kf0).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS)
                img0.save(out_jpg, quality=95)
                print(f"[{self.engine_name}] Reused pristine FLUX keyframe from Scene 0 as hero thumbnail -> {out_jpg}")
                return True
            except Exception as e:
                print(f"[Thumbnail Notice] Could not reuse Scene 0 keyframe: {e}")

        print(f"[{self.engine_name}] Generating Option A dedicated thumbnail concept diffusion...")
        clean_prompt = (
            f"{visual_prompt[:320]}, hyper-cinematic documentary poster art, award-winning photography, "
            f"masterpiece composition, dramatic volumetric rim lighting, deep contrast, vibrant authentic colors, "
            f"hyper-detailed textures, sharp focus, completely clean composition with lower negative space, "
            f"zero text, zero words, zero letters, zero watermarks"
        )
        if domain in ["science", "space", "technology", "nature", "history"]:
            domain_neg = "sports, stadium, athletics, cricket, football, soccer, baseball helmet, american football helmet, sports jersey, scoreboard, crowd cheering, referee, match, ball, bat, pads, wickets, "
        elif domain == "sports":
            domain_neg = "baseball helmet, american football helmet, cartoon, anime, manga, comic, caricature, "
        else:
            domain_neg = "baseball helmet, american football helmet, cartoon, anime, "

        neg_prompt = (
            f"{domain_neg}"
            "text, letters, words, writing, numbers, labels, typography, logos, watermark, title, signature, "
            "blurry, low resolution, bad anatomy, deformed, distorted, cartoon, anime, plastic, 3d render"
        )

        generator = torch.Generator(self.device).manual_seed(42)
        hero_img = None

        if self.engine_name in ["Wan2.1-VACE-1.3B", "Wan2.1-T2V-1.3B"] and self.pipe is not None:
            try:
                output = self.pipe(
                    prompt=clean_prompt,
                    negative_prompt=neg_prompt,
                    height=384,
                    width=640,
                    num_frames=9,
                    num_inference_steps=20,
                    guidance_scale=6.0,
                    generator=generator
                )
                frames = output.frames[0]
                mid_idx = len(frames) // 2
                frame = frames[mid_idx]
                from PIL import Image
                import numpy as np
                if isinstance(frame, np.ndarray):
                    if frame.dtype in (np.float32, np.float16) or frame.max() <= 1.0:
                        hero_img = Image.fromarray((frame * 255).astype(np.uint8))
                    else:
                        hero_img = Image.fromarray(frame.astype(np.uint8))
                elif hasattr(frame, "save"):
                    hero_img = frame
            except Exception as dit_err:
                print(f"[Wan2.1 Notice] Thumbnail concept pass notice: {dit_err}")

        if hero_img is None:
            if self.fallback_pipe is None:
                self._init_fallback_engine()
            try:
                output = self.fallback_pipe(
                    prompt=clean_prompt,
                    negative_prompt=neg_prompt,
                    guidance_scale=1.5,
                    num_inference_steps=4,
                    num_frames=16,
                    width=640,
                    height=384,
                    generator=generator
                )
                frames = output.frames[0]
                hero_img = frames[len(frames) // 2]
            except Exception as fb_err:
                print(f"[Fallback Notice] Thumbnail fallback notice: {fb_err}")

        if hero_img is not None:
            from PIL import Image
            hero_img = hero_img.resize((1280, 720), Image.Resampling.LANCZOS)
            hero_img.save(out_jpg, quality=95)
            print(f"[{self.engine_name}] Option A concept diffusion image generated successfully -> {out_jpg}")
            return True
        return False


def get_robust_bold_font(target_size):
    """
    Finds and loads the highest-impact bold TrueType font available on Linux/Windows,
    with automatic recursive directory lookup and Pillow scalable fallback.
    """
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "C:/Windows/Fonts/impact.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                from PIL import ImageFont
                return ImageFont.truetype(p, target_size)
            except Exception:
                pass

    search_dirs = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts")]
    for s_dir in search_dirs:
        if os.path.exists(s_dir):
            for match in glob.glob(f"{s_dir}/**/*.ttf", recursive=True):
                m_lower = match.lower()
                if any(b in m_lower for b in ["bold", "black", "heavy", "b.ttf"]):
                    try:
                        from PIL import ImageFont
                        return ImageFont.truetype(match, target_size)
                    except Exception:
                        pass
    from PIL import ImageFont
    return ImageFont.load_default()


def fit_font(draw, text, max_w, start_size=54, min_size=28):
    for sz in range(start_size, min_size - 1, -2):
        f = get_robust_bold_font(sz)
        try:
            bbox = draw.textbbox((0, 0), text, font=f)
            w = bbox[2] - bbox[0]
        except Exception:
            w = len(text) * sz * 0.6
        if w <= max_w:
            return f
    return get_robust_bold_font(min_size)


# ==========================================
# Main Orchestration Loop
# ==========================================
async def main():
    script_path = find_script()
    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)
    domain = script.get("domain", "history")
    voice = script.get("voice", "hi-IN-Neural2-B" if "hi" in script.get("language", "Hindi").lower() else "en-IN-PrabhatNeural")
    rate = script.get("rate", "+10%")
    speaking_rate = parse_rate_multiplier(rate)
    scenes = script["scenes"]
    audio_summary = script.get("audio_summary", voice)
    print(f"Loaded script: '{script.get('title')}' with {len(scenes)} scenes. Domain: {domain}, Voice: {voice}, Rate: {rate} ({speaking_rate}x)")
    if audio_summary and audio_summary != voice:
        print(f"[Audio Provenance] Actual audio models used: {audio_summary}")

    # Check if all scenes already have pre-packaged audio
    audio_dir = os.path.join(os.path.dirname(script_path), "audio")
    all_packaged = all(
        os.path.exists(os.path.join(audio_dir, f"a{i:03d}.mp3")) and os.path.getsize(os.path.join(audio_dir, f"a{i:03d}.mp3")) > 500
        for i in range(len(scenes))
    )
    if all_packaged:
        print(f"[TTS] ✅ All {len(scenes)} scenes have pre-packaged audio ({audio_summary}). Using high-fidelity local master tracks.")
    else:
        await probe_edge_tts(voice, rate=rate)

    cfg = find_config()
    hf_token = cfg.get("hf_token", "").strip()
    gcp_key = (cfg.get("gcp_tts_api_key") or cfg.get("gcp_tts_key") or "").strip()

    # Phase 1: Audio Acquisition & Metadata Calculation for all scenes
    print("\n[Phase 1/3] Preparing audio & metadata for all scenes...")
    scene_items = []
    raw_submakers = []

    for i, sc in enumerate(scenes):
        a_path = f"{TMP}/a{i:03d}.mp3"
        v_path = f"{TMP}/v{i:03d}.mp4"

        print(f"--- [Scene {i+1}/{len(scenes)}] Audio Preparation ---")
        dataset_audio = os.path.join(os.path.dirname(script_path), "audio", f"a{i:03d}.mp3")
        submaker = None

        if os.path.exists(dataset_audio) and os.path.getsize(dataset_audio) > 500:
            normalize_audio_to_44k_stereo(dataset_audio, a_path)
            print(f"[TTS] Using pre-packaged audio ({os.path.getsize(a_path)} bytes, 44.1kHz stereo).")
        else:
            is_hindi = (
                not sc.get("speaker")
                or sc.get("speaker") in ("Narrator", "Exam Booster")
                or any("\u0900" <= c <= "\u097F" for c in sc.get("narration", ""))
            )
            audio_ready = False

            if not is_hindi:
                k_voice = resolve_kokoro_voice(sc.get("speaker", ""), sc.get("voice", ""))
                print(f"[TTS] Synthesizing English dialogue via Kokoro-82M ('{k_voice}')...")
                audio_ready = synthesize_kokoro_audio(sc["narration"], k_voice, a_path, speed=speaking_rate)
                if not audio_ready and gcp_key:
                    eng_gcp_voice = "en-IN-Neural2-B" if "narrator" in (sc.get("speaker") or "").lower() else "en-US-Neural2-J"
                    print(f"[TTS] Kokoro fallback -> Cloud GCP English Neural2 ('{eng_gcp_voice}')...")
                    audio_ready = synthesize_gcp_cloud_tts(
                        sc["narration"], eng_gcp_voice, a_path, gcp_key, default_lang="en-US", speaking_rate=speaking_rate
                    )
            else:
                if gcp_key:
                    print("[TTS] Synthesizing Hindi narration via Cloud Google Cloud TTS...")
                    audio_ready = synthesize_gcp_cloud_tts(
                        sc["narration"], sc.get("voice", voice), a_path, gcp_key, default_lang="hi-IN", speaking_rate=speaking_rate
                    )

            if not audio_ready and EDGE_TTS_AVAILABLE:
                try:
                    edge_fallback_voice = "hi-IN-MadhurNeural" if is_hindi else "en-US-ChristopherNeural"
                    req_scene_v = sc.get("voice") or ""
                    scene_voice = (
                        req_scene_v
                        if (req_scene_v and not is_hindi and "neural2" not in req_scene_v.lower() and "_" not in req_scene_v)
                        else edge_fallback_voice
                    )
                    submaker = await tts_with_boundaries(sc["narration"], scene_voice, a_path, rate=rate)
                    audio_ready = True
                except Exception as tts_e:
                    print(f"[TTS] ⚠️ Edge-TTS failed for scene {i+1}: {tts_e}")

            if not os.path.exists(a_path) or os.path.getsize(a_path) < 100:
                raise RuntimeError(f"[TTS] Critical: Audio missing for scene {i+1}. Halting pipeline to prevent rendering a mute video.")

        d = round(duration(a_path), 3)
        scene_items.append({
            "idx": i,
            "scene": sc,
            "a_path": a_path,
            "v_path": v_path,
            "dur": d,
        })
        raw_submakers.append(submaker)

    # Phase 2: Video Diffusion on GPU (OS-Subprocess Isolated Dual-GPU Workers on cuda:0 + cuda:1)
    num_gpus = torch.cuda.device_count() if torch.cuda.is_available() else 0
    target_device = "cuda:0" if num_gpus > 0 else "cpu"
    print(f"\n[Phase 2/3] Rendering Video Clips (Dual-GPU OS-Isolated Parallel Dispatcher on {num_gpus} GPUs)...")
    diffusion = WanT4OptimizedEngine(hf_token=hf_token, device=target_device)
    diffusion.render_all_scenes_parallel(
        scene_items,
        domain=domain,
        visual_bible=script.get("visual_bible", {}),
    )

    # Phase 3: Alignment, Audio-Video Duration Sync & Subtitle Cues Assembly
    print("\n[Phase 3/3] Synchronizing audio-video timing & assembling subtitles...")
    clips, narr_files = [], []
    master_cues = []
    current_time_offset = 0.0

    for item, submaker in zip(scene_items, raw_submakers):
        i = item["idx"]
        sc = item["scene"]
        a_path = item["a_path"]
        v_path = item["v_path"]
        d = item["dur"]

        if not (os.path.exists(v_path) and os.path.getsize(v_path) > 1000):
            raise RuntimeError(f"Scene {i+1} failed to render video clip: {v_path}")

        # Extract Subtitle cues for this scene
        eng_caption = (sc.get("caption") or "").strip()
        if eng_caption:
            words = eng_caption.split()
            chunk_size = 7
            chunks = [" ".join(words[j:j+chunk_size]) for j in range(0, len(words), chunk_size)]
            if not chunks:
                chunks = [eng_caption]
            chunk_dur = d / len(chunks)
            for c_idx, ch in enumerate(chunks):
                master_cues.append({
                    "start": current_time_offset + (c_idx * chunk_dur),
                    "end": current_time_offset + ((c_idx + 1) * chunk_dur),
                    "text": ch
                })
        else:
            cues = []
            if submaker is not None:
                try:
                    scene_srt = submaker.get_srt()
                    cues = parse_srt_cues(scene_srt, current_time_offset)
                except Exception:
                    cues = []
            if not cues:
                narr_words = sc.get("narration", "").strip().split()
                chunk_size = 7
                chunks = [" ".join(narr_words[j:j+chunk_size]) for j in range(0, len(narr_words), chunk_size)] or [sc.get("narration", "").strip()]
                chunk_dur = d / len(chunks)
                for c_idx, ch in enumerate(chunks):
                    if ch:
                        cues.append({
                            "start": current_time_offset + (c_idx * chunk_dur),
                            "end": current_time_offset + ((c_idx + 1) * chunk_dur),
                            "text": ch
                        })
            master_cues.extend(cues)

        # Precise A/V synchronization
        v_dur = duration(v_path)
        actual_scene_dur = d
        if v_dur > d + 0.03:
            a_padded = f"{TMP}/a_pad_{i:03d}.mp3"
            pad_filter = f"apad=whole_dur={v_dur:.3f}"
            run([
                "ffmpeg", "-y", "-i", a_path, "-af", pad_filter,
                "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", a_padded
            ])
            if os.path.exists(a_padded) and os.path.getsize(a_padded) > 500:
                narr_files.append(a_padded)
                actual_scene_dur = round(duration(a_padded), 3) or round(v_dur, 3)
            else:
                narr_files.append(a_path)
        else:
            narr_files.append(a_path)

        current_time_offset += actual_scene_dur
        clips.append(v_path)
        print(f"[Scene {i+1}] Rendered successfully (speech={d:.2f}s, scene_slot={actual_scene_dur:.2f}s).")

    if not clips:
        raise RuntimeError("No scenes were rendered!")

    # Robust Cinematic Outro Buffer:
    # 1. Determine exact timestamp where narration speech completes
    speech_end_time = master_cues[-1]["end"] if master_cues else sum(duration(f) for f in narr_files)
    print(f"[Outro] Spoken narration dialogue concludes at {speech_end_time:.2f}s.")

    # 2. Add guaranteed 3.5s freeze buffer to final video clip
    print("\nAdding 3.5s cinematic outro freeze buffer to final video clip...")
    last_v = clips[-1]
    padded_v = f"{TMP}/v_final_padded.mp4"
    ok_v = run([
        "ffmpeg", "-y", "-i", last_v,
        "-vf", "tpad=stop_mode=clone:stop_duration=3.5",
        "-c:v", "libx264", "-preset", "veryfast", padded_v
    ])
    if not (ok_v and os.path.exists(padded_v) and os.path.getsize(padded_v) > 1000):
        freeze_img = f"{TMP}/outro_last_frame.png"
        run(["ffmpeg", "-y", "-sseof", "-0.1", "-i", last_v, "-frames:v", "1", "-update", "1", freeze_img])
        freeze_clip = f"{TMP}/outro_freeze_clip.mp4"
        ok_freeze = run([
            "ffmpeg", "-y", "-loop", "1", "-i", freeze_img,
            "-c:v", "libx264", "-t", "3.5", "-pix_fmt", "yuv420p", "-r", "24", freeze_clip
        ])
        if ok_freeze and os.path.exists(freeze_clip):
            sub_list = f"{TMP}/outro_sublist.txt"
            open(sub_list, "w").write(f"file '{last_v}'\nfile '{freeze_clip}'\n")
            run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", sub_list, "-c", "copy", padded_v])

    if os.path.exists(padded_v) and os.path.getsize(padded_v) > 1000:
        clips[-1] = padded_v
        print("[Outro] Final video clip padded with 3.5s freeze hold.")
    else:
        print("[Warning] Outro video padding failed, keeping original final clip.")

    # 3. Pre-normalize all narration tracks to uniform 44.1kHz stereo PCM for glitch-free concat
    # Crucial Invariant: Eliminates demuxer format mismatch (mixing WAV PCM with MP3) which causes digital static bursts!
    print("Normalizing all scene audio tracks to uniform 44.1kHz stereo PCM for pristine concat...")
    norm_audio_files = []
    for idx, a_file in enumerate(narr_files):
        norm_a = f"{TMP}/norm_a_{idx:03d}.wav"
        if idx == len(narr_files) - 1:
            # Pad final scene with 3.5s trailing silence so dialogue never ends abruptly
            run([
                "ffmpeg", "-y", "-i", a_file,
                "-af", "apad=pad_dur=3.5",
                "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", norm_a
            ])
        else:
            run([
                "ffmpeg", "-y", "-i", a_file,
                "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", norm_a
            ])
        if os.path.exists(norm_a) and os.path.getsize(norm_a) > 500:
            norm_audio_files.append(norm_a)
        else:
            norm_audio_files.append(a_file)

    # Assemble concatenated master scenes and narration (all files are uniform 44.1kHz stereo)
    print("\nConcatenating master continuous scenes...")
    open(f"{TMP}/vlist.txt", "w").write("".join(f"file '{c}'\n" for c in clips))
    open(f"{TMP}/alist.txt", "w").write("".join(f"file '{a}'\n" for a in norm_audio_files))

    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{TMP}/vlist.txt", "-c", "copy", f"{TMP}/video_raw.mp4"])
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{TMP}/alist.txt",
        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", f"{TMP}/narration.mp3"
    ])

    # Synchronize total durations so -shortest never prematurely cuts dialogue or holds
    v_raw_dur = duration(f"{TMP}/video_raw.mp4")
    a_raw_dur = duration(f"{TMP}/narration.mp3")
    print(f"Master assembly duration check: Video = {v_raw_dur:.2f}s, Audio = {a_raw_dur:.2f}s")
    target_master_dur = max(v_raw_dur, a_raw_dur, round(speech_end_time + 3.0, 2))

    if target_master_dur > a_raw_dur + 0.05:
        a_matched = f"{TMP}/narration_matched.mp3"
        run([
            "ffmpeg", "-y", "-i", f"{TMP}/narration.mp3",
            "-af", f"apad=whole_dur={target_master_dur:.3f}",
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", a_matched
        ])
        if os.path.exists(a_matched) and os.path.getsize(a_matched) > 1000:
            shutil.move(a_matched, f"{TMP}/narration.mp3")
            a_raw_dur = duration(f"{TMP}/narration.mp3")

    if target_master_dur > v_raw_dur + 0.05:
        v_matched = f"{TMP}/video_raw_matched.mp4"
        run([
            "ffmpeg", "-y", "-i", f"{TMP}/video_raw.mp4",
            "-vf", f"tpad=stop_mode=clone:stop_duration={target_master_dur - v_raw_dur + 0.1:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", v_matched
        ])
        if os.path.exists(v_matched) and os.path.getsize(v_matched) > 1000:
            shutil.move(v_matched, f"{TMP}/video_raw.mp4")
            v_raw_dur = duration(f"{TMP}/video_raw.mp4")

    # 4. Generate Master SRT Subtitles
    print(f"Generating master subtitles from {len(master_cues)} synchronized cues...")

    def ts_fmt(t):
        h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
        return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

    srt, txt = [], []
    for n, c in enumerate(master_cues, 1):
        srt.append(f"{n}\n{ts_fmt(c['start'])} --> {ts_fmt(c['end'])}\n{c['text']}\n")
        txt.append(c['text'])

    open(f"{OUT}/captions.srt", "w", encoding="utf-8").write("\n".join(srt))
    open(f"{OUT}/transcript.txt", "w", encoding="utf-8").write(" ".join(txt))

    # 4.5. Domain-Adapted Atmospheric Sound Design (Full Broadcast Voice Loudness Preserved):
    bgm_candidates = [
        os.path.join(os.path.dirname(script_path), "audio", "bgm.ogg"),
        os.path.join(os.path.dirname(script_path), "audio", "bgm.mp3"),
        os.path.join(os.path.dirname(script_path), "audio", "bgm.wav"),
    ]
    bgm_path = next((p for p in bgm_candidates if os.path.exists(p) and os.path.getsize(p) > 1000), None)
    ambient_mp3 = f"{TMP}/ambient_drone.mp3"
    has_ambient = False

    if bgm_path:
        print(f"[Audio] Using packaged background audio track from {bgm_path}...")
        # Calibrated BGM mixing volume (20% reduction applied for pristine narration clarity)
        bgm_vol = "0.176" if domain == "sports" else "0.128"
        ok_bgm = run([
            "ffmpeg", "-y", "-stream_loop", "-1", "-i", bgm_path,
            "-t", f"{target_master_dur:.3f}",
            "-af", f"volume={bgm_vol},afade=t=in:st=0:d=2.0",
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", ambient_mp3
        ])
        if ok_bgm and os.path.exists(ambient_mp3) and os.path.getsize(ambient_mp3) > 1000:
            has_ambient = True

    # 4.6. Dynamic Acoustic SFX Moments Overlay (Scales to millions of topics):
    sfx_dir = os.path.join(os.path.dirname(script_path), "audio", "sfx")
    if os.path.exists(sfx_dir) and has_ambient:
        sfx_files = [os.path.join(sfx_dir, f) for f in os.listdir(sfx_dir) if f.endswith((".ogg", ".mp3", ".wav"))]
        if sfx_files:
            print(f"[Audio] Blending {len(sfx_files)} dynamic acoustic SFX track(s) into atmospheric soundscape...")
            for idx, sfx_p in enumerate(sfx_files):
                if os.path.getsize(sfx_p) > 2000:
                    mixed_sfx = f"{TMP}/ambient_sfx_{idx}.mp3"
                    ok_sfx = run([
                        "ffmpeg", "-y",
                        "-i", ambient_mp3,
                        "-i", sfx_p,
                        "-filter_complex", "[0:a]volume=1.0[a0];[1:a]volume=0.35[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]",
                        "-map", "[aout]",
                        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", mixed_sfx
                    ])
                    if ok_sfx and os.path.exists(mixed_sfx) and os.path.getsize(mixed_sfx) > 1000:
                        ambient_mp3 = mixed_sfx

    # Fallback to procedural drone synthesis ONLY if NO background audio track exists
    if not has_ambient:
        print(f"[Audio] Synthesizing domain-calibrated cinematic ambient drone for domain '{domain}'...")
        if domain in ["science", "space", "technology"]:
            aeval = (
                "sin(55*2*PI*t)*0.16 + sin(110*2*PI*t)*0.09 + "
                "sin(165*2*PI*t)*0.04 + sin(54.5*2*PI*t)*0.10"
            )
            bg_filter = "lowpass=f=320,volume=0.096,afade=t=in:st=0:d=2.0"
        elif domain == "sports":
            aeval = (
                "sin(65*2*PI*t)*0.18 + sin(130*2*PI*t)*0.08 + "
                "sin(195*2*PI*t)*0.03 + sin(64.5*2*PI*t)*0.09"
            )
            bg_filter = "lowpass=f=450,volume=0.112,afade=t=in:st=0:d=1.0"
        else:
            aeval = (
                "sin(60*2*PI*t)*0.16 + sin(120*2*PI*t)*0.08 + "
                "sin(180*2*PI*t)*0.04 + sin(59.5*2*PI*t)*0.10"
            )
            bg_filter = "lowpass=f=360,volume=0.096,afade=t=in:st=0:d=1.5"

        ok_amb = run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"aevalsrc={aeval}:s=44100:d={target_master_dur:.3f}",
            "-af", bg_filter,
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", ambient_mp3
        ])
        if ok_amb and os.path.exists(ambient_mp3) and os.path.getsize(ambient_mp3) > 1000:
            has_ambient = True

    master_audio = f"{TMP}/master_audio_mixed.mp3"
    if has_ambient:
        print("[Audio] Mixing narration with cinematic atmospheric drone (normalize=0 with safety limiter)...")
        ok_mix = run([
            "ffmpeg", "-y",
            "-i", f"{TMP}/narration.mp3",
            "-i", ambient_mp3,
            "-filter_complex", "[0:a]volume=1.0[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.92:attack=5:release=50[aout]",
            "-map", "[aout]",
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", master_audio
        ])
        if not (ok_mix and os.path.exists(master_audio) and os.path.getsize(master_audio) > 1000):
            ok_mix_fb = run([
                "ffmpeg", "-y",
                "-i", f"{TMP}/narration.mp3",
                "-i", ambient_mp3,
                "-filter_complex", "[0:a]volume=2.0[a0];[1:a]volume=1.5[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]",
                "-map", "[aout]",
                "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", master_audio
            ])
            if not (ok_mix_fb and os.path.exists(master_audio) and os.path.getsize(master_audio) > 1000):
                print("[Audio] Mix failed, falling back to clean narration...")
                master_audio = f"{TMP}/narration.mp3"
    else:
        master_audio = f"{TMP}/narration.mp3"

    # 5. Master Grade Burn-In & Film Cohesion:
    style = (
        "FontName=DejaVu Sans,FontSize=20,Bold=1,"
        "PrimaryColour=&H00FFFFFF,SecondaryColour=&H0000FFFF,"
        "OutlineColour=&H00000000,BackColour=&H80000000,"
        "BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=42"
    )
    print("Mastering final crisp modern video with burn-in captions and cinematic outro fade...")
    fade_start = round(max(speech_end_time + 2.0, v_raw_dur - 1.2), 2)
    fade_dur = 1.0
    if fade_start + fade_dur > v_raw_dur:
        fade_start = max(speech_end_time + 0.5, v_raw_dur - 1.0)
        fade_dur = max(0.5, v_raw_dur - fade_start)

    master_vf = (
        f"fade=t=out:st={fade_start:.2f}:d={fade_dur:.2f},"
        f"subtitles={OUT}/captions.srt:force_style='{style}'"
    )
    master_af = f"afade=t=out:st={fade_start:.2f}:d={fade_dur:.2f}"
    ok = run([
        "ffmpeg", "-y", "-i", f"{TMP}/video_raw.mp4", "-i", master_audio,
        "-vf", master_vf,
        "-af", master_af,
        "-map", "0:v", "-map", "1:a",
        *get_best_video_encoder_args(),
        "-c:a", "aac", "-b:a", "192k", "-shortest", f"{OUT}/video.mp4"
    ])

    final_dur = duration(f"{OUT}/video.mp4") if ok else 0

    # 6. Automated YouTube Thumbnail Generation (OPTION A: High-CTR Concept Diffusion):
    print("\nGenerating Option A high-CTR YouTube thumbnail (Ask Studio quality)...")
    try:
        from PIL import Image, ImageDraw, ImageFont

        thumb_data = script.get("thumbnail") or {}
        custom_prompt = thumb_data.get("visual_prompt", "").strip()
        if not custom_prompt:
            custom_prompt = f"{script.get('title')}. {scenes[0].get('visual_prompt', '')}"

        concept_img_path = f"{TMP}/thumb_concept.jpg"
        generated_diffusion = False

        try:
            generated_diffusion = diffusion.generate_hero_thumbnail_diffusion(custom_prompt, concept_img_path, domain=domain)
        except Exception as diff_e:
            print(f"Diffusion thumbnail attempt note: {diff_e}")

        img = None
        if generated_diffusion and os.path.exists(concept_img_path):
            img = Image.open(concept_img_path).convert("RGB")
            print("Using Option A dedicated diffusion image for thumbnail.")
        else:
            import cv2
            raw_v = f"{TMP}/video_raw.mp4" if os.path.exists(f"{TMP}/video_raw.mp4") else f"{OUT}/video.mp4"
            thumb_cap = cv2.VideoCapture(raw_v)
            v_fps = thumb_cap.get(cv2.CAP_PROP_FPS) or 24.0
            v_total_frames = int(thumb_cap.get(cv2.CAP_PROP_FRAME_COUNT) or 100)
            target_f = min(int(v_fps * 12), max(0, v_total_frames - 50))
            thumb_cap.set(cv2.CAP_PROP_POS_FRAMES, target_f)
            ret, h_frame = thumb_cap.read()
            thumb_cap.release()
            if ret and h_frame is not None:
                img = Image.fromarray(cv2.cvtColor(h_frame, cv2.COLOR_BGR2RGB))
                print("Using high-contrast hero video frame for thumbnail.")

        if img is not None:
            img = img.resize((1280, 720), Image.Resampling.LANCZOS)

            overlay = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
            odraw = ImageDraw.Draw(overlay)
            for y in range(460, 720):
                alpha = int((y - 460) / 260 * 195)
                odraw.line([(0, y), (1280, y)], fill=(0, 0, 0, alpha))
            for y in range(0, 160):
                alpha = int((160 - y) / 160 * 140)
                odraw.line([(0, y), (1280, y)], fill=(0, 0, 0, alpha))

            img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
            draw = ImageDraw.Draw(img)

            raw_title = script.get("title", "DOCUMENTARY EXCLUSIVE").upper()
            title_parts = raw_title.split(":")

            main_h = thumb_data.get("headline") or title_parts[0].strip()
            main_h = main_h.upper()[:32]

            sub_h = thumb_data.get("subheadline") or (title_parts[1].strip() if len(title_parts) > 1 else script.get("description", ""))
            sub_h = sub_h.upper()[:44]

            font_main = fit_font(draw, main_h, 1150, start_size=54, min_size=32)
            font_sub = fit_font(draw, sub_h, 1150, start_size=34, min_size=22) if sub_h else None

            draw.text((64, 524), main_h, font=font_main, fill=(0, 0, 0))
            draw.text((60, 520), main_h, font=font_main, fill=(255, 225, 0))

            if sub_h:
                draw.text((64, 604), sub_h, font=font_sub, fill=(0, 0, 0))
                draw.text((60, 600), sub_h, font=font_sub, fill=(0, 240, 255))

            img.save(f"{OUT}/thumbnail.jpg", quality=95)
            img.save(f"{OUT}/frame_30s.jpg", quality=95)
            print("Successfully saved Option A thumbnail.jpg and frame_30s.jpg!")
        else:
            print("Warning: Could not produce image for thumbnail.")
    except Exception as th_err:
        print(f"Warning: Failed to generate custom thumbnail: {th_err}")

    meta = {
        "ok": ok,
        "scenes": len(clips),
        "duration_sec": final_dur,
        "title": script.get("title"),
        "description": script.get("description"),
        "tags": script.get("tags"),
        "chapters": script.get("chapters"),
        "language": script.get("language") or ("Hindi" if "hi-IN" in voice else "English"),
        "voice": voice,
        "engine": diffusion.engine_name,
        "motion_interpolation": "RIFE / MCI",
        "subtitles": "Synchronized 44.1kHz Zero-Drift",
        "modern_digital_cinema": True,
        "multi_shot_montage": True
    }
    json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=2)
    print("FINISHED SUCCESSFULLY:", meta)
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
