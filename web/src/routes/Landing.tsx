import { AlzaLogo } from '../components/AlzaLogo';

/** Public landing (D43). Placeholder until Fase 9; the copy is the value proposition of spec 1.3. */
export function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <AlzaLogo />
      <h1 className="text-2xl leading-tight font-bold">
        Manda tus Yapes y cuéntame tus ventas por WhatsApp, sin cambiar tu rutina.
      </h1>
      <p className="text-muted">
        Al final del día sabes cuánto entró, cuánto salió y cuánto te quedó.
      </p>
    </main>
  );
}
