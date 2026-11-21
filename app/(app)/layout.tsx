import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { RpcChainBanner } from "@/components/layout/RpcChainBanner";
import { SidebarProvider } from "@/providers/SidebarProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* NetworkGuard is placed outside SidebarProvider so that the network
          mismatch warning renders independently of the sidebar state and is
          always visible regardless of sidebar open/close transitions. */}
      <RpcChainBanner />
      <NetworkGuard />
      <SidebarProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          {/* min-w-0: a flex item's min-width defaults to its content width, so without it a wide
              table pushes this column past the viewport instead of scrolling in its card. */}
          <div className="flex-1 flex flex-col min-h-screen min-w-0 lg:ml-64">
            <Header />
            <main className="flex-1 p-6 lg:p-10">{children}</main>
          </div>
        </div>
      </SidebarProvider>
    </>
  );
}
