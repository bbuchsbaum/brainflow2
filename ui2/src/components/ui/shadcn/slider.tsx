import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/utils/cn"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-5 w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden bg-[hsl(var(--muted))]">
      <SliderPrimitive.Range className="absolute h-full bg-[hsl(var(--primary))]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className="block h-5 w-3 bg-[hsl(var(--card))] border-2 border-[hsl(var(--primary))] ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-[hsl(var(--primary))] hover:border-[hsl(var(--primary))] cursor-pointer"
      style={{ borderRadius: '1px' }}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
