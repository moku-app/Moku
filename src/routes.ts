import Library    from "./components/pages/Library.svelte";
import Search     from "./components/pages/Search.svelte";
import History    from "./components/pages/History.svelte";
import Explore    from "./components/pages/Explore.svelte";
import Downloads  from "./components/pages/Downloads.svelte";
import Extensions from "./components/pages/Extensions.svelte";

export default {
  "/":            Library,
  "/search":      Search,
  "/history":     History,
  "/explore":     Explore,
  "/downloads":   Downloads,
  "/extensions":  Extensions,
};
