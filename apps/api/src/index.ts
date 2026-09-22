import { main } from "./boot.js";

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
