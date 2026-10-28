import { getCurrentUser } from "@/lib/auth";
import { AnnouncementBar } from "./AnnouncementBar";
import { Logo } from "./Logo";
import { SiteNav } from "./SiteNav";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <>
      <AnnouncementBar />
      <header className="site-header public-header">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div className="container public-nav-shell">
          <Logo />
          <SiteNav loggedIn={Boolean(user)} />
        </div>
      </header>
    </>
  );
}
