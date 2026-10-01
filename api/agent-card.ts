import { card, options } from "../src/http.js";
export const GET = (req: Request) => card(req);
export const OPTIONS = () => options();
