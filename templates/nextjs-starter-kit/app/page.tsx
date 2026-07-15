export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-6 px-8 py-24 text-center sm:text-left">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Peek Pro App Starter Kit
        </h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          A Next.js starter kit for building apps that embed in Peek Pro. The
          main experience lives under{" "}
          <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-base dark:bg-zinc-800">
            app/peek-pro/main
          </code>
          . See{" "}
          <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-base dark:bg-zinc-800">
            AGENTS.md
          </code>{" "}
          for the iframe embed constraints and conventions.
        </p>
      </main>
    </div>
  );
}
