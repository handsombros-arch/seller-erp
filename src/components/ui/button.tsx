import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * 앱 표준 버튼 — 디자인 기준: 높이 32px 기본 / 28px 소형, 라운드 10px, 13px semibold.
 * 페이지에서 raw <button className="h-10 px-4 rounded-xl bg-brand ..."> 대신 이걸 사용한다.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-brand-hover",
        destructive: "bg-danger/10 text-danger hover:bg-danger/15",
        outline: "border border-line bg-card text-fg-2 hover:bg-card-2 hover:text-fg",
        secondary: "bg-app text-fg-2 hover:bg-line-2 hover:text-fg",
        ghost: "text-fg-3 hover:bg-app hover:text-fg",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 rounded-lg px-2.5 text-[12px]",
        lg: "h-10 rounded-xl px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
