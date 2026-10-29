import { useMemo } from 'react'
import {
  Modal,
  Form,
  Input,
  Select,
  Row,
  Col,
  Switch,
  InputNumber,
} from 'antd'
import type { Tag, Device } from '../types'
import {
  getProtocolConfig,
  modbusFunctionCodes,
  combinedDataTypes,
  toCombinedValue,
  parseCombinedValue,
} from '../data/protocolConfigs'

interface Props {
  open: boolean
  tag: Tag | null
  devices: Device[]
  onClose: () => void
  onSave: (tag: Tag) => void
}

function splitAddress(address?: string, functionCode?: string) {
  if (!address) return { address: '', functionCode }
  if (functionCode) return { address, functionCode }
  const matched = address.match(/^(\d{1,2}):(.+)$/)
  if (matched) {
    return { functionCode: matched[1].padStart(2, '0'), address: matched[2] }
  }
  return { address, functionCode }
}

export default function TagFormDrawer({ open, tag, devices, onClose, onSave }: Props) {
  const [form] = Form.useForm()
  const deviceId = Form.useWatch('deviceId', form)
  const functionCode = Form.useWatch('functionCode', form) as string | undefined

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId]
  )

  const protocolConfig = useMemo(
    () => (selectedDevice ? getProtocolConfig(selectedDevice.protocol) : undefined),
    [selectedDevice]
  )

  const functionCodeLabel = protocolConfig?.functionCodeLabel ?? '寄存器类型'
  const functionCodeOptions = protocolConfig?.functionCodes ?? modbusFunctionCodes
  const showFunctionCode = !selectedDevice || (protocolConfig?.functionCodes?.length ?? 0) > 0
  const coilLike = functionCode === '01' || functionCode === '02'

  const dataTypeSelectOptions = useMemo(() => {
  const supported = new Set(
    protocolConfig?.supportedDataTypes ?? combinedDataTypes.map((item) => item.dataType)
  )
  // 是否属于“线圈/寄存器”模型（如 Modbus、S7 区、三菱软元件等）
  const hasCoilConcept = (protocolConfig?.functionCodes?.length ?? 0) > 0

  return combinedDataTypes
    .filter((item) => supported.has(item.dataType))
    .filter((item) => {
      // 没有线圈概念的协议（如 EtherNet/IP、OPC UA、MQTT），不做 bool 过滤
      if (!hasCoilConcept) return true
      // 有线圈概念的协议，保留原有逻辑
      return coilLike ? item.dataType === 'bool' : item.dataType !== 'bool'
    })
    .map((item) => ({ value: item.value, label: item.label }))
    }, [protocolConfig, coilLike])

  const handleFunctionCodeChange = (code: string) => {
    const option = functionCodeOptions.find((item) => item.value === code)
    if (option?.dataTypeHint === 'bool') {
      form.setFieldsValue({ dataTypeCombo: 'bool:AB' })
    } else if (form.getFieldValue('dataTypeCombo') === 'bool:AB') {
      form.setFieldsValue({ dataTypeCombo: 'int16:AB' })
    }
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    const device = devices.find((d) => d.id === values.deviceId)
    const parsed = parseCombinedValue(values.dataTypeCombo)
    onSave({
      ...tag,
      ...values,
      dataType: parsed.dataType,
      byteOrder: parsed.byteOrder,
      deviceName: device?.name ?? '',
      quality: tag?.quality ?? 'uncertain',
      scale: values.scale ?? 1,
      offset: values.offset ?? 0,
      accessMode: values.accessMode ?? 'read',
      group: undefined,
      description: undefined,
    } as Tag)
  }

  return (
    <Modal
      title={tag ? '编辑点位' : '添加点位'}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={480}
      centered
      destroyOnHidden
      styles={{ body: { paddingTop: 8, maxHeight: '70vh', overflowY: 'auto' } }}
      afterOpenChange={(visible) => {
        if (visible) {
          if (tag) {
            form.setFieldsValue({
              ...tag,
              ...splitAddress(tag.address, tag.functionCode),
              dataTypeCombo: toCombinedValue(tag.dataType, tag.byteOrder),
            })
          } else {
            form.setFieldsValue({
              enabled: true,
              accessMode: 'read',
              functionCode: '03',
              dataTypeCombo: 'int16:AB',
              scale: 1,
              offset: 0,
            })
          }
        }
      }}
    >
      <Form form={form} layout="vertical" size="middle" style={{ marginTop: 4 }}>
        <Row gutter={12}>
          <Col span={16}>
            <Form.Item
              name="name"
              label="寄存器名称"
              rules={[{ required: true, message: '请输入名称' }]}
              style={{ marginBottom: 12 }}
            >
              <Input placeholder="例如：温度" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="enabled" label="启用" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="deviceId"
          label="所属设备"
          rules={[{ required: true, message: '请选择设备' }]}
          style={{ marginBottom: 12 }}
        >
          <Select
            placeholder="选择设备"
            options={devices.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(id: string) => {
              const current = form.getFieldValue('functionCode')
              const nextDevice = devices.find((d) => d.id === id)
              const nextCodes = nextDevice
                ? getProtocolConfig(nextDevice.protocol)?.functionCodes
                : modbusFunctionCodes
              if (nextCodes?.length && !nextCodes.some((item) => item.value === current)) {
                form.setFieldsValue({ functionCode: nextCodes[0].value })
              }
            }}
          />
        </Form.Item>

        <Row gutter={12}>
          {showFunctionCode && (
            <Col span={12}>
              <Form.Item
                name="functionCode"
                label={functionCodeLabel}
                rules={[{ required: true, message: `请选择${functionCodeLabel}` }]}
                style={{ marginBottom: 12 }}
              >
                <Select
                  options={functionCodeOptions.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  onChange={handleFunctionCodeChange}
                />
              </Form.Item>
            </Col>
          )}
          <Col span={showFunctionCode ? 12 : 24}>
            <Form.Item
              name="address"
              label="寄存器地址"
              rules={[{ required: true, message: '请输入地址' }]}
              style={{ marginBottom: 12 }}
            >
              <Input placeholder={protocolConfig?.addressExample ?? '40001'} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="dataTypeCombo"
          label="数据类型"
          rules={[{ required: true, message: '请选择数据类型' }]}
          style={{ marginBottom: 12 }}
        >
          <Select options={dataTypeSelectOptions} />
        </Form.Item>

        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="scale" label="系数" style={{ marginBottom: 12 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="offset" label="偏移" style={{ marginBottom: 12 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="unit" label="单位" style={{ marginBottom: 12 }}>
              <Input placeholder="℃" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="accessMode" label="读写属性" style={{ marginBottom: 0 }}>
          <Select
            options={[
              { value: 'read', label: '只读' },
              { value: 'write', label: '只写' },
              { value: 'readwrite', label: '读写' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
