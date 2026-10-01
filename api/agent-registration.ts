import { options, registration } from "../src/http.js";
export const GET = (req: Request) => registration(req);
export const OPTIONS = () => options();
