"use client"

import { useId } from "react"
import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import { useWorkbenchStore } from "@/stores/workbench-store"

export function StatusBarWorkbenchMode() {
  const t = useTranslations("Workbench")
  const mode = useWorkbenchStore((state) => state.uiMode)
  const id = useId()
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-1">
      <label htmlFor={id} className="cursor-pointer text-xs">
        {t("workbench")}
      </label>
      <Switch
        id={id}
        aria-label={t("workbench")}
        checked={mode === "unified"}
        onCheckedChange={(checked) =>
          useWorkbenchStore
            .getState()
            .setUiMode(checked ? "unified" : "classic")
        }
      />
    </div>
  )
}
