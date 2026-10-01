import { a2a, options } from "../src/http.js";
export const GET = (req: Request) => a2a(req);
export const POST = (req: Request) => a2a(req);
export const OPTIONS = () => options();
