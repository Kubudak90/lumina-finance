import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { SidebarProvider } from "@/providers/SidebarProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* NetworkGuard is placed outside SidebarProvider so that the network
          mismatch warning renders independently of the sidebar state and is
          always visible regardless of sidebar open/close transitions. */}
      <NetworkGuard />
      <SidebarProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-screen lg:ml-64">
            <Header />
            <main className="flex-1 p-6 lg:p-10">{children}</main>
          </div>
        </div>
      </SidebarProvider>
    </>
  );
}
