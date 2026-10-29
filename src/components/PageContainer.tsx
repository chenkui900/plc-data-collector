import { useRef, useState, useLayoutEffect, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { Card } from 'antd'

interface PageContainerProps {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  bodyStyle?: React.CSSProperties
}

/** 全屏页面容器：禁止页面级滚动，内容区内部滚动 */
export default function PageContainer({ title, extra, children, bodyStyle }: PageContainerProps) {
  return (
    <div className="page-container">
      <Card
        className="page-card"
        title={title}
        extra={extra}
        variant="borderless"
        styles={{
          header: { minHeight: 60, padding: '0 24px', flexShrink: 0, fontSize: 18 },
          body: {
            flex: 1,
            padding: 20,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            ...bodyStyle,
          },
        }}
      >
        {children}
      </Card>
    </div>
  )
}

interface TableScrollProps {
  scroll?: { x?: number | string | true; y?: number | string }
}

/** 表格区域：占满剩余高度，内部滚动 */
export function TableWrapper({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [y, setY] = useState(360)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const pagination = el.querySelector('.ant-pagination') as HTMLElement | null
      const header = el.querySelector('.ant-table-header, .ant-table-thead') as HTMLElement | null
      const paginationH = pagination ? pagination.offsetHeight + 16 : 8
      const headerEl = (header?.closest('.ant-table-header') as HTMLElement | null) ?? header
      const headerH = headerEl?.offsetHeight ?? 55
      setY(Math.max(180, el.clientHeight - paginationH - headerH))
    }

    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    const timer = window.setTimeout(update, 80)
    return () => {
      ro.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<TableScrollProps>, {
        scroll: {
          x: (children as ReactElement<TableScrollProps>).props.scroll?.x,
          y,
        },
      })
    : children

  return (
    <div className="table-wrapper" ref={ref}>
      {child}
    </div>
  )
}

/** 工具栏区域 */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="page-toolbar">{children}</div>
}

/** Dashboard 网格布局 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="dashboard-grid">{children}</div>
}

export function DashboardPanel({
  title,
  extra,
  children,
  className = '',
}: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`dashboard-panel ${className}`}>
      {(title || extra) && (
        <div className="dashboard-panel-header">
          {title && <span className="dashboard-panel-title">{title}</span>}
          {extra && <div>{extra}</div>}
        </div>
      )}
      <div className="dashboard-panel-body">{children}</div>
    </div>
  )
}
