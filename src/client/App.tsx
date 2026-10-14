import { Suspense, lazy } from "react";
import { PlayerApp, Splash } from "./player/PlayerApp";
import { AskHost, SvgDefs, Toaster } from "./ui";

const TvApp = lazy(() => import("./tv/TvApp").then((m) => ({ default: m.TvApp })));
const AdminApp = lazy(() => import("./admin/AdminApp").then((m) => ({ default: m.AdminApp })));

export function App() {
  const path = location.pathname.replace(/\/+$/, "");
  const screen = path === "/tv" ? <TvApp /> : path === "/admin" ? <AdminApp /> : <PlayerApp />;
  if (path === "/tv") document.documentElement.classList.add("is-tv");
  return (
    <>
      <SvgDefs />
      <Suspense fallback={<Splash />}>{screen}</Suspense>
      <Toaster />
      <AskHost />
    </>
  );
}
