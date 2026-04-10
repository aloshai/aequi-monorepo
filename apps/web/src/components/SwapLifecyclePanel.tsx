import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface SwapLifecyclePanelProps {
  title: string
  detail: string
  activeStep: number
  error?: string | null
}

const STEPS = ['Quote', 'Review', 'Approve', 'Execute']

export function SwapLifecyclePanel({ title, detail, activeStep, error }: SwapLifecyclePanelProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Transaction Progress</CardTitle>
            <Badge variant={error ? 'danger' : activeStep >= 4 ? 'success' : 'secondary'}>
              {error ? 'Action Needed' : activeStep >= 4 ? 'Done' : 'In Progress'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-4">
            {STEPS.map((step, index) => {
              const isDone = index < activeStep
              const isActive = index === activeStep
              return (
                <div
                  key={step}
                  className={`rounded-md border px-2 py-2 text-center text-xs font-semibold ${
                    isDone
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : isActive
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-border bg-muted/30 text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  )
}
