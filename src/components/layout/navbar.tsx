"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { NAV_LINKS, APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { LoginButton } from "@/components/layout/login-modal";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

const NAV_TRANSLATION_KEYS: Record<string, keyof typeof import("@/lib/translations/en").en.nav> = {
  "/": "news",
  "/sports": "sports",
  "/portfolio": "portfolio",
  "/trade": "paperTrade",
  "/airdrop": "airdrop",
  "/ai": "aiConsensus",
};

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { t } = useT();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0d1117] border-b border-[#21262d]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect width="24" height="24" rx="6" fill="#58a6ff" />
              <path d="M7 12l3 3 7-7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[15px] font-semibold text-white">
              {APP_NAME}
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const key = NAV_TRANSLATION_KEYS[link.href];
              const label = key ? t.nav[key] : link.label;
              const isAirdrop = link.href === "/airdrop";
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors",
                    pathname === link.href
                      ? "text-white"
                      : "text-[#768390] hover:text-white",
                    isAirdrop && "hover:text-[#f5c542]",
                    isAirdrop && pathname === link.href && "text-[#f5c542]",
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          <div className="hidden md:flex items-center gap-2">
            <LanguageSwitcher />
            <LoginButton />
          </div>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className="md:hidden p-2 text-[#768390] hover:text-white">
              <Menu className="w-5 h-5" />
            </SheetTrigger>
            <SheetContent side="right" className="bg-[#161b22] border-[#21262d] w-64">
              <SheetTitle className="text-white font-semibold">{APP_NAME}</SheetTitle>
              <div className="flex flex-col gap-1 mt-6">
                {NAV_LINKS.map((link) => {
                  const key = NAV_TRANSLATION_KEYS[link.href];
                  const label = key ? t.nav[key] : link.label;
                  const isAirdrop = link.href === "/airdrop";
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "px-3 py-2.5 rounded-md text-sm",
                        pathname === link.href
                          ? "text-white bg-[#1c2128]"
                          : "text-[#768390] hover:text-white",
                        isAirdrop && "hover:text-[#f5c542]",
                        isAirdrop && pathname === link.href && "text-[#f5c542]",
                      )}
                    >
                      {label}
                    </Link>
                  );
                })}
                <div className="mt-3 flex items-center gap-2">
                  <LanguageSwitcher />
                  <LoginButton />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
