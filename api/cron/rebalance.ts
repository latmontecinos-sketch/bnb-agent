import { cronRebalance } from "../../src/http.js";
export const GET = (req: Request) => cronRebalance(req);
export const POST = (req: Request) => cronRebalance(req);
