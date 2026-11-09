import { AlzaLogo } from '../components/AlzaLogo';

/** `/app/*`: the user's web (enlace + PIN). Placeholder until Fase 7; loaded on demand. */
export default function AppHome() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col">
      <header className="flex min-h-[52px] items-center px-4 pt-1.5">
        <AlzaLogo />
      </header>
      <main className="flex-1 px-4 py-4">
        <div className="rounded-[18px] border border-border bg-card p-4">
          <p className="text-muted">Esta sección está en construcción.</p>
        </div>
      </main>
    </div>
  );
}
