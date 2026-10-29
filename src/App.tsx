import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import MainLayout from './layouts/MainLayout'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import Tags from './pages/Tags'
import Protocols from './pages/Protocols'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Push from './pages/Push'
import { useEffect } from 'react'

const theme = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 8,
    fontSize: 16,
    fontSizeLG: 18,
    fontSizeHeading5: 18,
    controlHeight: 40,
    controlHeightLG: 44,
    controlHeightSM: 32,
    colorText: 'rgba(0, 0, 0, 0.88)',
  },
  components: {
    Layout: {
      headerHeight: 60,
      siderBg: '#001529',
    },
    Menu: {
      darkItemBg: '#001529',
      itemHeight: 48,
      fontSize: 16,
      iconSize: 18,
    },
    Table: {
      cellFontSize: 16,
      headerBg: '#f7f8fa',
      cellPaddingBlock: 14,
      cellPaddingInline: 16,
      fontSize: 16,
    },
    Form: {
      labelFontSize: 16,
      itemMarginBottom: 20,
    },
    Card: {
      headerFontSize: 18,
    },
    Button: {
      contentFontSize: 16,
      paddingInline: 18,
    },
    Modal: {
      titleFontSize: 18,
    },
  },
}

function App() {
  // Wake Lock：页面可见时申请屏幕常亮
  useEffect(() => {
    let lock: any = null
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen')
      } catch { /* 浏览器不支持或被拒绝 */ }
    }
    request()
    const onVis = () => {
      if (document.visibilityState === 'visible') request()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.()
    }
  }, [])

  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="devices" element={<Devices />} />
            <Route path="tags" element={<Tags />} />
            <Route path="push" element={<Push />} />
            <Route path="protocols" element={<Protocols />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}

export default App