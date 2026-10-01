import { health, options } from "../src/http.js";
export const GET = () => health();
export const OPTIONS = () => options();
