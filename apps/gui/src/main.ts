import "./app.css";
import "uplot/dist/uPlot.min.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app not found");

mount(App, { target });
