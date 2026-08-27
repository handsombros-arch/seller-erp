import * as React from "react"

import { cn } from "@/lib/utils"

/** 앱 표준 입력 — 높이 32px, 라운드 10px, 13px. 페이지별 inputCls 상수 대신 사용. */
const inputClassName =
  "flex h-8 w-full rounded-[10px] border border-line bg-card px-3 text-[13px] text-fg placeholder:text-fg-5 transition-colors focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-[12px] file:font-medium"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        lang="ko"
        className={cn(inputClassName, className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputClassName }
