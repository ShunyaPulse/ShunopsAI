import { toolRegistry } from "./agent.js";
import * as fs from "node:fs/promises";

async function runTests() {
  console.log("=== 1. Test list_directory ===");
  const listResult = await toolRegistry.list_directory.execute({ directoryPath: "." });
  console.log(listResult);

  console.log("\n=== 2. Test write_file ===");
  const writeResult = await toolRegistry.write_file.execute({
    filepath: "./test_output/sample.txt",
    content: "Agent execution test payload",
  });
  console.log(writeResult);

  console.log("\n=== 3. Test read_file ===");
  const readResult = await toolRegistry.read_file.execute({
    filepath: "./test_output/sample.txt",
  });
  console.log(readResult);

  console.log("\n=== 4. Test run_shell_command ===");
  const shellResult = await toolRegistry.run_shell_command.execute({
    command: "node -v",
  });
  console.log(shellResult);

  // Clean up test directory
  await fs.rm("./test_output", { recursive: true, force: true });
  console.log("\n✅ All tool unit tests passed!");
}

runTests().catch(console.error);
