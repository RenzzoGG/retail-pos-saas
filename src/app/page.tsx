import Link from "next/link";
import { buttonClasses } from "@/components/ui/button-styles";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-bold tracking-tight">Stocktill</h1>
      <p className="max-w-md text-lg text-foreground/70">Point of sale and inventory for small shops.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/signup" className={buttonClasses("primary")}>
          Get started
        </Link>
        <Link href="/login" className={buttonClasses("secondary")}>
          Sign in
        </Link>
      </div>
      <p className="text-sm text-foreground/50">Stocktill is a fictional brand created for a portfolio project.</p>
    </main>
  );
}
