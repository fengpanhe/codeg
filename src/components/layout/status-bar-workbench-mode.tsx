"use client"

import { Columns2, LayoutPanelLeft } from "lucide-react"
import { useTranslations } from "next-intl"
import { useWorkbenchStore } from "@/stores/workbench-store"
import { cn } from "@/lib/utils"

export function StatusBarWorkbenchMode() {
  const t = useTranslations("Workbench")
  const mode = useWorkbenchStore((state) => state.uiMode)
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      role="group"
      aria-label={t("interfaceMode")}
    >
      {(["classic", "unified"] as const).map((value) => {
        const Icon = value === "classic" ? LayoutPanelLeft : Columns2
        return (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            aria-label={t(value)}
            title={t(value)}
            onClick={() => useWorkbenchStore.getState().setUiMode(value)}
            className={cn(
              "flex h-6 items-center gap-1 rounded px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === value
                ? "bg-accent text-foreground"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            <span className="hidden md:inline">{t(value)}</span>
          </button>
        )
      })}
    </div>
  )
}
