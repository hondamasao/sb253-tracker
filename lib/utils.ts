import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines conditional class names and resolves Tailwind class conflicts
 * (e.g. `cn("p-2", condition && "p-4")` correctly keeps only "p-4"). This
 * is the standard shadcn/ui helper, used by every component below.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
