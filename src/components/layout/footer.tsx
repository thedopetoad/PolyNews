import { APP_NAME } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="border-t border-[#21262d]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#484f58]">
          <span>{APP_NAME} &middot; Live News + Prediction Markets</span>
          <div className="flex items-center gap-5">
            <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="hover:text-[#768390]">Polymarket</a>
            <a href="/docs" className="hover:text-[#768390]">Docs</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
