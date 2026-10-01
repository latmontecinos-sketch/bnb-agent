import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("tools/register.html", "public/register.html");
console.log("copied tools/register.html -> public/register.html");
