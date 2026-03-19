import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/global.css";

mount(App, { target: document.getElementById("app")! });
