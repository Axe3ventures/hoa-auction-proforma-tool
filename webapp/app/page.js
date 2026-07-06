import DealWorkspace from "./components/DealWorkspace";
import { DEAL_CONFIG } from "../lib/dealConfig";

export default function SheriffSalesPage() {
  return <DealWorkspace dealType="sheriff" {...DEAL_CONFIG.sheriff} />;
}
