import { useEffect, useState } from 'react'
import { Form, InputNumber, Select, Switch, Button, Divider, message, Row, Col } from 'antd'
import PageContainer from '../components/PageContainer'
import { api } from '../api/http'
import { useRealtime } from '../api/realtime'
import type { AppSettings } from '../api/types'

export default function Settings() {
  const [form] = Form.useForm<AppSettings>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.settings.get()
      .then((data) => form.setFieldsValue(data))
      .catch((error) => message.error((error as Error).message))
  }, [form])

  useRealtime((msg) => {
    if (msg.type === 'settings') form.setFieldsValue(msg.data)
    if (msg.type === 'hello' && 'settings' in msg.data && msg.data.settings) {
      form.setFieldsValue(msg.data.settings)
    }
  })

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const saved = await api.settings.save(values)
      form.setFieldsValue(saved)
      message.success('设置已保存，采集服务已按新参数运行')
    } catch (error) {
      if (error instanceof Error) message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="settings-page">
      <PageContainer title="系统设置">
        <Form
          form={form}
          layout="vertical"
          size="large"
          style={{ maxWidth: 720 }}
        >
          <Divider plain>采集服务</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="globalPollInterval" label="默认轮询间隔 (ms)" rules={[{ required: true }]}>
                <InputNumber min={100} max={60000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxConcurrent" label="最大并发采集数" extra="同时轮询的设备上限" rules={[{ required: true }]}>
                <InputNumber min={1} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="autoReconnect" label="自动重连" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="reconnectInterval" label="重连间隔 (ms)" rules={[{ required: true }]}>
                <InputNumber min={1000} max={60000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>数据与日志</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="logLevel" label="日志级别" rules={[{ required: true }]}>
                <Select options={['debug', 'info', 'warn', 'error'].map((v) => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="logRetention" label="日志保留天数" rules={[{ required: true }]}>
                <InputNumber min={1} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="maxLogEntries" label="日志最大条数" extra="超出后自动删除最旧记录" rules={[{ required: true }]}>
                <InputNumber min={100} max={20000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="coldDataDays" label="冷数据保留天数" extra="长期未启用的设备/点位/推送会自动清理" rules={[{ required: true }]}>
                <InputNumber min={1} max={3650} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>Web 服务</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="webPort" label="服务端口" extra="保存后下次启动生效">
                <InputNumber min={1024} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enableCors" label="启用 CORS" valuePropName="checked" extra="保存后下次启动生效">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 8 }}>
            <Button type="primary" size="large" loading={loading} onClick={() => void handleSave()}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </PageContainer>
    </div>
  )
}
