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
    <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-[hsl(var(--muted))]">
      <SliderPrimitive.Range className="absolute h-full bg-[hsl(var(--primary))]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className="block h-3 w-3 rounded-full bg-[hsl(199_89%_48%)] ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-[hsl(199_89%_60%)] cursor-pointer"
      style={{ boxShadow: '0 0 0 1px hsl(220 56% 4% / 0.7)' }}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
