import { useEffect, useState } from 'react'
import { Layout, Menu, Badge, Typography, theme } from 'antd'
import {
  DashboardOutlined,
  HddOutlined,
  NodeIndexOutlined,
  ApiOutlined,
  FileTextOutlined,
  SettingOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'
import type { Device } from '../types'

const { Sider, Header, Content } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '运行概览' },
  { key: '/devices', icon: <HddOutlined />, label: '设备管理' },
  { key: '/tags', icon: <NodeIndexOutlined />, label: '点位配置' },
  { key: '/push', icon: <SendOutlined />, label: '推送配置' },
  { key: '/protocols', icon: <ApiOutlined />, label: '协议支持' },
  { key: '/logs', icon: <FileTextOutlined />, label: '实时日志' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
]

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(new Date())
  const [collecting, setCollecting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    api.devices.list()
      .then((devices) => setCollecting(devices.some((item) => item.enabled)))
      .catch(() => undefined)
  }, [])

  const refreshCollecting = (list: Device[]) => {
    setCollecting(list.some((item) => item.enabled))
  }

  useRealtime((msg) => {
    if (msg.type === 'hello' && 'devices' in msg.data) {
      refreshCollecting(msg.data.devices as Device[])
    }
    if (msg.type === 'device') {
      void api.devices.list().then(refreshCollecting).catch(() => undefined)
    }
  })

  const selectedKey = menuItems.find((item) =>
    item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key)
  )?.key ?? '/'

  return (
    <Layout className="app-layout">
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={64}
        theme="dark"
        className="app-sider"
      >
        <div className="app-logo">
          <ApiOutlined className="app-logo-icon" />
          {!collapsed && (
            <div className="app-logo-text">
              <Text strong className="app-logo-title">Plc_Aotu</Text>
              <Text className="app-logo-sub">工业数据采集</Text>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="app-menu"
        />
      </Sider>

      <Layout className="app-main">
        <Header className="app-header" style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Text strong className="app-header-title">
            {menuItems.find((m) => m.key === selectedKey)?.label ?? '运行概览'}
          </Text>
          <div className="app-header-right">
            <Badge status={collecting ? 'processing' : 'default'} text={collecting ? '采集中' : '未采集'} />
            <Text type="secondary" className="app-header-time">
              {now.toLocaleString('zh-CN')}
            </Text>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
