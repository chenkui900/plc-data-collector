import { Tag, Typography } from 'antd'
import PageContainer from '../components/PageContainer'
import { protocolConfigs } from '../data/protocolConfigs'

const { Text, Paragraph } = Typography

export default function Protocols() {
  return (
    <PageContainer title={`协议支持  ${protocolConfigs.length}`} bodyStyle={{ overflow: 'auto' }}>
      <div className="protocol-grid">
        {protocolConfigs.map((p) => (
          <div key={p.type} className="protocol-card">
            <div className="protocol-card-head">
              <Text strong className="protocol-card-title">{p.name}</Text>
              <Tag color="blue">{p.category}</Tag>
            </div>
            <Paragraph type="secondary" className="protocol-card-desc">
              {p.description}
            </Paragraph>
            <div className="protocol-card-meta">
              <div>
                <span className="meta-label">地址示例</span>
                <span className="meta-value">{p.addressExample}</span>
              </div>
              <div>
                <span className="meta-label">连接参数</span>
                <span className="meta-value">{p.connectionFields.map((f) => f.label).join('、')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  )
}
