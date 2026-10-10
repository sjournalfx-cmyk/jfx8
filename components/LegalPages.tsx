import React from 'react';

/**
 * In-app fallback for /privacy and /terms.
 * The canonical public pages are static files (public/privacy.html,
 * public/terms.html served via vercel rewrites) so logged-out visitors get
 * HTTP 200 + content without JS. These views cover in-app navigation
 * (footer links while logged in) using the same text and site look.
 */

const shell = 'min-h-dvh w-full bg-[#000000] text-zinc-100';
const wrap = 'mx-auto w-full max-w-3xl px-6 py-12 sm:py-16';
const h1 = 'text-3xl sm:text-4xl font-black tracking-tight mb-2';
const effective = 'text-sm text-zinc-500 mb-8';
const h2 = 'text-lg font-extrabold mt-8 mb-3 text-white';
const p = 'text-[15px] leading-relaxed text-zinc-300 my-3';
const ul = 'list-disc pl-6 my-3 space-y-1.5 text-[15px] leading-relaxed text-zinc-300';

const LegalFooter: React.FC = () => (
  <footer className="mt-14 border-t border-white/10 pt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-zinc-500">
    <span>&copy; 2026 JFX-JOURNAL</span>
    <a href="/" className="font-bold hover:text-zinc-200">Home</a>
    <a href="/privacy" className="font-bold hover:text-zinc-200">Privacy Policy</a>
    <a href="/terms" className="font-bold hover:text-zinc-200">Terms of Service</a>
    <a href="mailto:sjournalfx@gmail.com" className="font-bold hover:text-zinc-200">sjournalfx@gmail.com</a>
  </footer>
);

export const PrivacyPolicy: React.FC = () => (
  <div className={shell}>
    <div className={wrap}>
      <h1 className={h1}>JFX-JOURNAL Privacy Policy</h1>
      <p className={effective}>Effective date: 9 October 2026</p>
      <p className={p}>JFX-JOURNAL (&ldquo;JFX&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a trading journal web and mobile app operated by Phemelo Prince Moatshe in South Africa. This policy explains what personal information we collect, why, and your rights under the Protection of Personal Information Act (POPIA).</p>

      <h2 className={h2}>1. Information we collect</h2>
      <ul className={ul}>
        <li>Account information: name, email address and profile picture, when you sign up with email or with Google.</li>
        <li>Google sign-in: we receive only your name, email address and profile picture. We do not access your Gmail, Drive, Calendar or other Google data.</li>
        <li>Trade data: trades, balances, positions and account details imported from MT4/MT5 (through the Desktop Bridge or broker VPS sync), from cTrader, or entered manually.</li>
        <li>Journal content: notes, tags, screenshots, strategies and rules, backtests, goals and milestones, performance reports, and psychology notes about your mindset, emotions and discipline.</li>
        <li>Connections and keys: broker access tokens and JFX Developer API keys. These are stored encrypted and never shown in full after creation.</li>
        <li>Usage data: log data, IP address, device and browser type, app version and basic feature analytics.</li>
      </ul>

      <h2 className={h2}>2. How we use it</h2>
      <ul className={ul}>
        <li>To create, secure and sign in to your account.</li>
        <li>To sync, store and search your trade history.</li>
        <li>To produce your analytics, trade reviews, summaries and sentiment analysis, and to check trades against your rules.</li>
        <li>To track your goals and send milestone alerts.</li>
        <li>To run the Developer API, including enforcing your portfolio locks and risk rules on orders.</li>
        <li>To fix problems, prevent abuse and improve JFX.</li>
        <li>To contact you about your account, security or important changes.</li>
      </ul>
      <p className={p}>We do not sell your personal information or use your trade data for advertising.</p>

      <h2 className={h2}>3. Psychology and journal notes</h2>
      <p className={p}>Your psychology notes and journal entries are private to your account. We use them only to give you insights, and never share them for any other purpose.</p>

      <h2 className={h2}>4. Google user data</h2>
      <p className={p}>JFX&rsquo;s use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. Google data is used only to sign you in, is never sold, and is never used for advertising or to train AI models.</p>

      <h2 className={h2}>5. Who we share it with</h2>
      <p className={p}>Only service providers that help run JFX:</p>
      <ul className={ul}>
        <li>Supabase (database, authentication, hosting)</li>
        <li>Brokers and platforms you connect, such as cTrader (Spotware) and your MT4/MT5 broker or VPS, to sync accounts and place orders you or your authorised agents request</li>
        <li>AI model providers that process the trade reviews and questions you request</li>
        <li>Hosting and analytics providers</li>
      </ul>
      <p className={p}>We may also disclose information when the law requires it.</p>

      <h2 className={h2}>6. International transfers</h2>
      <p className={p}>Some providers process data outside South Africa. We use only providers that offer adequate protection, as POPIA requires.</p>

      <h2 className={h2}>7. How long we keep it</h2>
      <p className={p}>While your account is active. After you delete your account, we delete or anonymise your information within 30 days, unless the law requires us to keep it longer.</p>

      <h2 className={h2}>8. Security</h2>
      <p className={p}>We use encryption in transit, encrypted storage for tokens and keys, access controls and row-level security. Keep your password, Desktop Bridge and API keys private.</p>

      <h2 className={h2}>9. Your rights</h2>
      <p className={p}>You can ask to see, correct, export or delete your information, object to processing, or withdraw consent at any time. You can disconnect brokers and revoke API keys in Settings, and remove Google access in your Google Account. You may complain to the Information Regulator of South Africa.</p>

      <h2 className={h2}>10. Children</h2>
      <p className={p}>JFX is for people aged 18 and older.</p>

      <h2 className={h2}>11. Changes</h2>
      <p className={p}>We will post updates here with a new effective date, and notify you of significant changes.</p>

      <h2 className={h2}>12. Contact</h2>
      <p className={p}>sjournalfx@gmail.com &middot; jfxjournal.site</p>

      <LegalFooter />
    </div>
  </div>
);

export const TermsOfService: React.FC = () => (
  <div className={shell}>
    <div className={wrap}>
      <h1 className={h1}>JFX-JOURNAL Terms of Service</h1>
      <p className={effective}>Effective date: 9 October 2026</p>
      <p className={p}>These terms govern your use of JFX-JOURNAL (&ldquo;JFX&rdquo;), a trading journal operated by Phemelo Prince Moatshe in South Africa. By using JFX, you agree to them.</p>

      <h2 className={h2}>1. What JFX is</h2>
      <p className={p}>JFX helps you log, analyse and improve your trading. It syncs trades from MT4/MT5 (through the Desktop Bridge or VPS sync) and cTrader, or takes manual entries. It provides analytics, trade reviews, goal tracking, strategy and backtesting tools, psychology tracking, and a Developer API.</p>

      <h2 className={h2}>2. Not financial advice</h2>
      <p className={p}>Nothing in JFX is financial, investment or trading advice. That includes statistics, reviews, AI summaries, backtests and tips. JFX is not a broker or a financial services provider. Trading forex, CFDs and crypto carries a high risk of loss. You are solely responsible for your trading decisions.</p>

      <h2 className={h2}>3. Your account</h2>
      <p className={p}>You must be 18 or older and give accurate information. Keep your login, Desktop Bridge and API keys secure. You are responsible for all activity through them.</p>

      <h2 className={h2}>4. Broker sync and orders</h2>
      <p className={p}>When you connect a broker, you authorise JFX to access it within the permissions you grant. Orders placed through JFX, the Developer API or agents you connect are made on your instruction and at your own risk. Portfolio locks and risk rules are tools, not guarantees. JFX is not responsible for broker or VPS outages, sync gaps, price errors, slippage, rejected orders or delays.</p>

      <h2 className={h2}>5. Analysis and backtests</h2>
      <p className={p}>Reviews, sentiment analysis and backtest results may be inaccurate or incomplete, and past performance does not predict future results.</p>

      <h2 className={h2}>6. Developer API</h2>
      <p className={p}>API keys are personal. Don&rsquo;t share them, resell access, or exceed reasonable usage. We may limit or revoke keys that are misused.</p>

      <h2 className={h2}>7. Acceptable use</h2>
      <p className={p}>Don&rsquo;t attempt unauthorised access, copy or reverse engineer JFX, overload or scrape it, or use it to break the law or your broker&rsquo;s terms.</p>

      <h2 className={h2}>8. Your content</h2>
      <p className={p}>You own your trades, notes and journal content. You let JFX store and process them only to provide the service, and you can export or delete them at any time.</p>

      <h2 className={h2}>9. Plans and payments</h2>
      <p className={p}>Some features may need a paid plan or credits, with prices shown before you pay. During the beta, features may change.</p>

      <h2 className={h2}>10. Availability</h2>
      <p className={p}>JFX is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, and may change or be interrupted.</p>

      <h2 className={h2}>11. Limitation of liability</h2>
      <p className={p}>To the extent the law allows, JFX is not liable for trading losses, lost profits, lost data or indirect damages. Our total liability is limited to what you paid JFX in the 12 months before the claim. Nothing here limits your rights under the Consumer Protection Act that cannot be excluded.</p>

      <h2 className={h2}>12. Termination</h2>
      <p className={p}>You can delete your account at any time. We may suspend accounts that break these terms.</p>

      <h2 className={h2}>13. Changes</h2>
      <p className={p}>Updates are posted here with a new effective date. If you keep using JFX, you accept them.</p>

      <h2 className={h2}>14. Governing law</h2>
      <p className={p}>The laws of the Republic of South Africa.</p>

      <h2 className={h2}>15. Contact</h2>
      <p className={p}>sjournalfx@gmail.com &middot; jfxjournal.site</p>

      <LegalFooter />
    </div>
  </div>
);

export default PrivacyPolicy;
