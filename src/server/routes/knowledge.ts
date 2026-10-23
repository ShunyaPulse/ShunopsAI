import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import {
  searchKnowledgeHybrid,
  indexKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeStats,
} from "../db.js";
import { isAdminUser } from "../scope.js";

export interface KnowledgeRouteOptions {
  requireAuth: preHandlerHookHandler;
}

export async function knowledgeRoutes(
  app: FastifyInstance,
  options: KnowledgeRouteOptions
): Promise<void> {
  const { requireAuth } = options;

  // 0. Inspect Hybrid Knowledge Engine & Embedding Cache Stats
  app.get("/api/knowledge/stats", { preHandler: [requireAuth] }, async () => {
    return {
      success: true,
      stats: getKnowledgeStats(),
    };
  });

  // 1. Search knowledge base via Neon Lakebase Hybrid Search (Public / Authenticated)
  app.get<{
    Querystring: { q?: string; category?: string; limit?: string };
  }>("/api/knowledge/search", async (req, reply) => {
    const query = req.query.q?.trim();
    if (!query) {
      reply.status(400);
      return { success: false, error: "Search query 'q' parameter is required." };
    }

    const category = req.query.category?.trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);

    const results = await searchKnowledgeHybrid(query, {
      category: category || undefined,
      limit,
    });

    return {
      success: true,
      query,
      category: category || null,
      results,
      engine: getKnowledgeStats().activeTier,
    };
  });

  // 2. Index a new knowledge document (Admin/Operator only — matches host-tier tool policy)
  app.post<{
    Body: {
      title: string;
      content: string;
      category?: string;
      metadata?: Record<string, any>;
    };
  }>("/api/knowledge/index", { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return { success: false, error: "Access denied. Administrator privileges required to modify the global knowledge base." };
    }

    const { title, content, category, metadata } = req.body || {};
    if (!title || !content) {
      reply.status(400);
      return { success: false, error: "Both 'title' and 'content' are required." };
    }

    const doc = await indexKnowledgeDocument(
      title,
      content,
      category || "general",
      metadata || {}
    );

    return {
      success: true,
      document: doc,
    };
  });

  // 3. Delete a knowledge document (Admin/Operator only)
  app.delete<{
    Params: { id: string };
  }>("/api/knowledge/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdminUser((req as any).user)) {
      reply.status(403);
      return { success: false, error: "Access denied. Administrator privileges required to delete knowledge documents." };
    }

    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      reply.status(400);
      return { success: false, error: "Valid document ID required." };
    }

    const deleted = await deleteKnowledgeDocument(id);
    return {
      success: deleted,
    };
  });

  // Helper: Chunk text into overlapping segments for vector indexing
  function chunkDocument(text: string, chunkSize = 1200, overlap = 150): string[] {
    const clean = text.replace(/\r\n/g, "\n").trim();
    if (clean.length <= chunkSize) return [clean];
    const chunks: string[] = [];
    let start = 0;
    while (start < clean.length) {
      let end = start + chunkSize;
      if (end < clean.length) {
        const nextBreak = clean.lastIndexOf("\n", end);
        if (nextBreak > start + 300) {
          end = nextBreak;
        } else {
          const nextSpace = clean.lastIndexOf(" ", end);
          if (nextSpace > start + 300) end = nextSpace;
        }
      }
      const chunk = clean.slice(start, end).trim();
      if (chunk.length > 20) chunks.push(chunk);
      start = end - overlap;
    }
    return chunks;
  }

  // Helper: Extract text from PDF buffer
  function extractPdfText(buf: Buffer): string {
    const str = buf.toString("latin1");
    const textChunks: string[] = [];
    
    // Safe linear scanner for literal strings in ( ... ) Tj / ' / " without ReDoS
    let tjIdx = 0;
    while (tjIdx < str.length) {
      const openP = str.indexOf("(", tjIdx);
      if (openP === -1) break;
      const closeP = str.indexOf(")", openP + 1);
      if (closeP === -1) break;
      const after = str.slice(closeP + 1, closeP + 10).trimStart();
      if (after.startsWith("Tj") || after.startsWith("'") || after.startsWith('"')) {
        const unescaped = str
          .slice(openP + 1, closeP)
          .replace(/\\([()\\])/g, "$1")
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t");
        textChunks.push(unescaped);
      }
      tjIdx = closeP + 1;
    }

    const arrayTjRegex = /\[([^\]]*)\]\s*TJ/g;
    let match;
    while ((match = arrayTjRegex.exec(str)) !== null) {
      if (match[1]) {
        const content = match[1];
        let idx = 0;
        while (idx < content.length) {
          const start = content.indexOf('(', idx);
          if (start === -1) break;
          const end = content.indexOf(')', start + 1);
          if (end === -1) break;
          textChunks.push(content.slice(start + 1, end));
          idx = end + 1;
        }
      }
    }
    const extracted = textChunks.join(" ").replace(/\s+/g, " ").trim();
    if (extracted.length < 50) {
      const rawAscii = str.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
      const words = rawAscii.split(" ").filter((w) => w.length >= 3 && !w.startsWith("/") && !w.includes("Obj") && !w.includes("endobj"));
      if (words.length > 20) return words.slice(0, 3000).join(" ");
    }
    return extracted;
  }

  // 4. Upload & Vector-Index Document (PDF, Markdown, Code, TXT)
  app.post<{
    Body: {
      fileName: string;
      fileType?: string;
      content: string;
      category?: string;
    };
  }>("/api/knowledge/upload-document", { preHandler: [requireAuth] }, async (req, reply) => {
    const { fileName, fileType, content, category } = req.body || {};
    if (!fileName || !content) {
      reply.status(400);
      return { success: false, error: "Both 'fileName' and 'content' are required." };
    }

    let rawText = "";
    const isBase64 = content.startsWith("data:") || content.includes(";base64,");
    if (isBase64) {
      const b64Data = content.split(",")[1] || content;
      const buf = Buffer.from(b64Data, "base64");
      const isPdf = (fileType && fileType.includes("pdf")) || fileName.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        rawText = extractPdfText(buf);
      } else {
        rawText = buf.toString("utf-8");
      }
    } else {
      rawText = content;
    }

    if (!rawText || rawText.trim().length < 10) {
      reply.status(400);
      return { success: false, error: "Could not extract readable text from the uploaded document." };
    }

    const chunks = chunkDocument(rawText);
    const cat = category || "documents";
    const indexedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const title = chunks.length === 1 ? fileName : `${fileName} (Part ${i + 1}/${chunks.length})`;
      const doc = await indexKnowledgeDocument(title, chunk, cat, {
        fileName,
        chunkIndex: i,
        totalChunks: chunks.length,
        uploadedAt: new Date().toISOString(),
      });
      indexedChunks.push(doc.id);
    }

    return {
      success: true,
      fileName,
      totalChunks: chunks.length,
      indexedIds: indexedChunks,
      engine: getKnowledgeStats().activeTier,
    };
  });

  // 5. Connect & Index GitHub Repository into Neon pgvector RAG
  app.post<{
    Body: {
      repoUrl: string;
      branch?: string;
      token?: string;
    };
  }>("/api/knowledge/connect-github", { preHandler: [requireAuth] }, async (req, reply) => {
    const { repoUrl, branch, token } = req.body || {};
    if (!repoUrl) {
      reply.status(400);
      return { success: false, error: "GitHub repository URL or 'owner/repo' is required." };
    }

    let cleanRepo = repoUrl.trim();
    if (cleanRepo.startsWith("https://github.com/") || cleanRepo.startsWith("http://github.com/")) {
      cleanRepo = cleanRepo.replace(/^https?:\/\/github\.com\//i, "");
    }
    if (cleanRepo.endsWith(".git")) {
      cleanRepo = cleanRepo.slice(0, -4);
    }
    while (cleanRepo.endsWith("/")) {
      cleanRepo = cleanRepo.slice(0, -1);
    }
    const parts = cleanRepo.split("/");
    if (parts.length < 2) {
      reply.status(400);
      return { success: false, error: "Invalid repository format. Please provide 'owner/repo' or a valid GitHub URL." };
    }
    const [owner, repo] = parts;
    const resolvedBranch = branch?.trim() || "main";
    const ghToken = token?.trim() || process.env.GH_PAT || process.env.GITHUB_TOKEN;

    const GITHUB_SEGMENT_REGEX = /^[a-zA-Z0-9_.-]+$/;
    if (!owner || !repo || !GITHUB_SEGMENT_REGEX.test(owner) || !GITHUB_SEGMENT_REGEX.test(repo)) {
      reply.status(400);
      return { success: false, error: "Invalid repository format. Owner and repo must be alphanumeric." };
    }
    if (!GITHUB_SEGMENT_REGEX.test(resolvedBranch)) {
      reply.status(400);
      return { success: false, error: "Invalid branch name format." };
    }

    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const safeBranch = encodeURIComponent(resolvedBranch);

    const headers: Record<string, string> = {
      "User-Agent": "ShunopsAI-Agent/3.0",
      Accept: "application/vnd.github.v3+json",
    };
    if (ghToken) {
      headers["Authorization"] = `Bearer ${ghToken}`;
    }

    let treeRes = await fetch(
      `https://api.github.com/repos/${safeOwner}/${safeRepo}/git/trees/${safeBranch}?recursive=1`,
      { headers }
    );

    if (!treeRes.ok && resolvedBranch === "main") {
      treeRes = await fetch(
        `https://api.github.com/repos/${safeOwner}/${safeRepo}/git/trees/master?recursive=1`,
        { headers }
      );
    }

    if (!treeRes.ok) {
      const errText = await treeRes.text();
      reply.status(treeRes.status);
      return {
        success: false,
        error: `GitHub API error (${treeRes.status}): ${errText.slice(0, 200)}`,
      };
    }

    const treeData = (await treeRes.json()) as any;
    const tree = treeData.tree || [];

    const priorityFiles = tree
      .filter((item: any) => item.type === "blob")
      .filter((item: any) => {
        const p = item.path.toLowerCase();
        return (
          p === "readme.md" ||
          p === "architecture.md" ||
          p === "package.json" ||
          p.startsWith("docs/") ||
          p.endsWith(".md") ||
          (p.startsWith("src/") && (p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".py")))
        );
      })
      .slice(0, 20);

    if (priorityFiles.length === 0) {
      return {
        success: false,
        error: "No indexable documentation or source files found in repository tree.",
      };
    }

    const indexedFiles: string[] = [];
    for (const file of priorityFiles) {
      try {
        if (typeof file.path !== "string" || file.path.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(file.path)) {
          continue;
        }
        const safePath = encodeURI(file.path);
        const rawUrl = `https://raw.githubusercontent.com/${safeOwner}/${safeRepo}/${safeBranch}/${safePath}`;
        const rawRes = await fetch(rawUrl, { headers });
        if (rawRes.ok) {
          const content = await rawRes.text();
          if (content && content.length > 20) {
            const chunks = chunkDocument(content, 1500, 150);
            for (let cIdx = 0; cIdx < Math.min(chunks.length, 5); cIdx++) {
              const chunkText = chunks[cIdx];
              if (!chunkText) continue;
              await indexKnowledgeDocument(
                `${owner}/${repo}: ${file.path}${chunks.length > 1 ? ` (${cIdx + 1})` : ""}`,
                chunkText,
                "github-repo",
                {
                  repo: `${owner}/${repo}`,
                  path: file.path,
                  branch: resolvedBranch,
                }
              );
            }
            indexedFiles.push(file.path);
          }
        }
      } catch {}
    }

    return {
      success: true,
      repo: `${owner}/${repo}`,
      branch: resolvedBranch,
      indexedFilesCount: indexedFiles.length,
      indexedFiles,
      engine: getKnowledgeStats().activeTier,
    };
  });
}
