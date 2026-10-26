import { Store } from "./database.js";
const store = new Store();
store.close();
console.log("SQLite migrations applied.");
