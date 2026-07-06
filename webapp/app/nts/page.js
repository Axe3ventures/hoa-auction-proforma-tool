import DealWorkspace from "../components/DealWorkspace";
import { DEAL_CONFIG } from "../../lib/dealConfig";

export default function NtsPage() {
  return <DealWorkspace dealType="nts" {...DEAL_CONFIG.nts} />;
}
