import DropZone from "./ui/DropZone";
import Workspace from "./ui/Workspace";
import { useParseWorker } from "./data/useParseWorker";

export default function App() {
  const { state, load, reset } = useParseWorker();
  if (state.phase !== "done") return <DropZone state={state} onFile={load} />;
  return <Workspace data={state.data} onReload={reset} />;
}
