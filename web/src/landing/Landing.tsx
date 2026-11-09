import './landing.css';
import { SiteFooter, SiteHeader } from './Chrome';
import { Hackathon } from './Hackathon';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { Rewards } from './Rewards';
import { Trust } from './Trust';
import { Waitlist } from './Waitlist';
import { WebPreview } from './WebPreview';

/** Public landing at `/` (D43, Fase 9). */
export function Landing() {
  return (
    <div id="inicio" className="lp-root min-h-dvh bg-bg">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-full bg-navy px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">
        <Hero />
        <HowItWorks />
        <WebPreview />
        <Rewards />
        <Trust />
        <Hackathon />
        <Waitlist />
      </main>
      <SiteFooter />
    </div>
  );
}
