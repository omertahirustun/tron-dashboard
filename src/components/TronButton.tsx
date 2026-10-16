import { motion, type HTMLMotionProps } from 'framer-motion'
import { sfx } from '../lib/sfx'

type Variant = 'ghost' | 'solid' | 'alert'

interface TronButtonProps extends HTMLMotionProps<'button'> {
  /** Identifies the button in sfx events, e.g. "toolbar.reset" */
  sfxSource: string
  variant?: Variant
}

const variants: Record<Variant, string> = {
  ghost: 'text-ink border-transparent hover:border-cyan-line hover:bg-cyan-soft hover:text-cyan',
  solid: 'text-cyan border-cyan-line bg-cyan-soft hover:border-cyan hover:shadow-glow',
  alert: 'text-orange border-orange/40 bg-orange-soft hover:border-orange hover:shadow-glow-orange',
}

export function TronButton({
  sfxSource,
  variant = 'ghost',
  className = '',
  onMouseEnter,
  onClick,
  ...rest
}: TronButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={`no-drag inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${className}`}
      onMouseEnter={(e) => {
        sfx.emit('hover', { source: sfxSource })
        onMouseEnter?.(e)
      }}
      onClick={(e) => {
        sfx.emit('click', { source: sfxSource })
        onClick?.(e)
      }}
      {...rest}
    />
  )
}
