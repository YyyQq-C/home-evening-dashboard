import {SITE,entityId} from './site-config.js';
// 沿用原居家首页的分组和实体绑定，仅供只读详情；不定义真实控制服务。
export const APPLIANCE_DEFINITIONS={
  "washer": {
    "name": "洗衣机",
    "model": "海尔 XHG13L98U1",
    "location": "生活阳台",
    "icon": "washer",
    "primary": entityId('sensor.example_gun_tong_xi_yi_ji_yun_xing_zhuang_tai'),
    "groups": [
      {
        "title": "运行状态",
        "items": [
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_yun_xing_zhuang_tai'),
            "name": "运行状态"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_xi_yi_cheng_xu'),
            "name": "当前洗衣程序"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_xi_di_jie_duan'),
            "name": "洗涤阶段"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_xi_di_shui_wen'),
            "name": "洗涤水温"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_tuo_shui_zhuan_su'),
            "name": "脱水转速"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_sheng_yu_piao_xi_ci_shu'),
            "name": "剩余漂洗次数"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_dang_qian_sheng_yu_yu_yue_shi_jian_xiao_shi'),
            "name": "剩余/预约小时"
          },
          {
            "entity": entityId('sensor.example_gun_tong_xi_yi_ji_dang_qian_sheng_yu_yu_yue_shi_jian_fen_zhong'),
            "name": "剩余/预约分钟"
          },
          {
            "entity": entityId('binary_sensor.example_gun_tong_xi_yi_ji_men_suo_zhuang_tai'),
            "name": "门锁"
          },
          {
            "entity": entityId('binary_sensor.example_gun_tong_xi_yi_ji_tong_suo_zhuang_tai'),
            "name": "童锁"
          },
          {
            "entity": entityId('binary_sensor.example_gun_tong_xi_yi_ji_yuan_cheng_kong_zhi_she_zhi_shi_neng'),
            "name": "远程控制设置使能"
          }
        ]
      },
      {
        "title": "基本操作",
        "items": [
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_kai_guan_ji_zhuang_tai'),
            "name": "电源"
          },
          {
            "entity": entityId('select.example_gun_tong_xi_yi_ji_yun_xing_zhuang_tai'),
            "name": "运行状态控制"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_yuan_cheng_kai_ji_qi_yong_zhuang_tai'),
            "name": "远程开机启用"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_yu_yue_gong_neng_zhuang_tai'),
            "name": "预约开关"
          }
        ]
      },
      {
        "title": "烘干与护理",
        "items": [
          {
            "entity": entityId('select.example_gun_tong_xi_yi_ji_hong_gan_qiang_du'),
            "name": "烘干强度"
          },
          {
            "entity": entityId('select.example_gun_tong_xi_yi_ji_yi_wu_cai_zhi'),
            "name": "衣物材质"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_xi_hong_lian_dong_gong_neng_zhuang_tai'),
            "name": "洗烘联动"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_hu_li_gong_neng'),
            "name": "护理功能"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_guang_deng_chi_zi_gong_neng'),
            "name": "光等离子功能"
          },
          {
            "entity": entityId('number.example_gun_tong_xi_yi_ji_guang_deng_chi_zi_hu_li_shi_jian'),
            "name": "光等离子护理时间"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_kang_zhou_gong_neng'),
            "name": "抗皱"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_mian_yun_tang_gong_neng_zhuang_tai'),
            "name": "免熨烫"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_fang_zhou_jin_pao_gong_neng_zhuang_tai'),
            "name": "防皱浸泡"
          }
        ]
      },
      {
        "title": "投放设置",
        "items": [
          {
            "entity": entityId('number.example_gun_tong_xi_yi_ji_xi_di_ji_tou_fang_liang'),
            "name": "洗涤剂投放量"
          },
          {
            "entity": entityId('number.example_gun_tong_xi_yi_ji_rou_shun_ji_tou_fang_liang'),
            "name": "柔顺剂投放量"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_xi_di_ji_btou_fang_zhuang_tai'),
            "name": "洗涤剂 B 投放"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_xiao_du_ji_zi_dong_tou_fang_gong_neng_zhuang_tai'),
            "name": "消毒剂自动投放"
          }
        ]
      },
      {
        "title": "洗涤附加功能",
        "items": [
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_ye_jian_xi_gong_neng_zhuang_tai'),
            "name": "夜间洗功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_fang_guo_min_gong_neng_zhuang_tai'),
            "name": "防过敏功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_spapiao_xi_jia_re_gong_neng'),
            "name": "SPA漂洗加热功能"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_zheng_qi_xi_zhuang_tai'),
            "name": "蒸汽洗状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_jia_su_xi_gong_neng_zhuang_tai'),
            "name": "加速洗功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_qiang_li_qu_wu_gong_neng_zhuang_tai'),
            "name": "强力去污功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_jing_shui_xi_cheng_xu_zhuang_tai'),
            "name": "净水洗程序状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_zhi_hui_xi_yi_cheng_xu_zhuang_tai'),
            "name": "智慧洗衣程序状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_gao_shui_wei_gong_neng_zhuang_tai'),
            "name": "高水位功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_jin_pao_xi_gong_neng_zhuang_tai'),
            "name": "浸泡洗功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_jie_neng_xi_gong_neng_zhuang_tai'),
            "name": "节能洗功能状态"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_shi_xi_cheng_xu'),
            "name": "湿洗程序"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_yu_yin_gong_neng_kai_guan'),
            "name": "语音功能开关"
          },
          {
            "entity": entityId('switch.example_gun_tong_xi_yi_ji_zi_wai_sha_jun_gong_neng_zhuang_tai'),
            "name": "紫外杀菌功能状态"
          }
        ]
      },
      {
        "title": "高级参数",
        "items": [
          {
            "entity": entityId('select.example_gun_tong_xi_yi_ji_cheng_xu_cun_chu_wei_zhi_bian_hao'),
            "name": "程序存储位置编号"
          },
          {
            "entity": entityId('select.example_gun_tong_xi_yi_ji_yun_cheng_xu_qi_dong_lai_yuan'),
            "name": "云程序启动来源"
          },
          {
            "entity": entityId('number.example_gun_tong_xi_yi_ji_she_ding_yi_wu_zhong_liang_yun_xing_hou_que_ding_de_zhong_liang'),
            "name": "设定衣物重量(运行后确定的重量)"
          },
          {
            "entity": entityId('number.example_gun_tong_xi_yi_ji_yun_cheng_xu_bian_hao'),
            "name": "云程序编号"
          }
        ]
      }
    ],
    "brand": "海尔"
  },
  "fridge": {
    "name": "冰箱",
    "model": "卡萨帝 BCD-570WGCFDM4WHU1 · 白色",
    "location": "厨房",
    "icon": "fridge",
    "primary": null,
    "groups": [],
    "brand": "卡萨帝"
  },
  "purifier": {
    "name": "净水器",
    "model": "美的 MRC1975-1000G",
    "location": "厨房",
    "icon": "drop",
    "primary": entityId('binary_sensor.example_purifier_device_status'),
    "availability": true,
    "groups": [
      {
        "title": "水质与滤芯",
        "items": [
          {
            "entity": entityId('binary_sensor.example_purifier_device_status'),
            "name": "设备状态"
          },
          {
            "entity": entityId('binary_sensor.example_purifier_standby_status'),
            "name": "龙头出水"
          },
          {
            "entity": entityId('sensor.example_purifier_in_tds'),
            "name": "原水 TDS"
          },
          {
            "entity": entityId('sensor.example_purifier_out_tds'),
            "name": "纯水 TDS"
          },
          {
            "entity": entityId('sensor.example_purifier_life_1'),
            "name": "PCB 滤芯剩余量"
          },
          {
            "entity": entityId('sensor.example_purifier_life_2'),
            "name": "RO 滤芯剩余量"
          },
          {
            "entity": entityId('sensor.example_purifier_water_consumption_l'),
            "name": "总用水量"
          }
        ]
      },
      {
        "title": "操作与设置",
        "items": [
          {
            "entity": entityId('select.example_purifier_cur_quantify'),
            "name": "定量设置"
          },
          {
            "entity": entityId('number.example_purifier_quantify_21'),
            "name": "小量用水量"
          },
          {
            "entity": entityId('number.example_purifier_quantify_22'),
            "name": "普通用水量"
          },
          {
            "entity": entityId('number.example_purifier_quantify_23'),
            "name": "大量用水量"
          },
          {
            "entity": entityId('select.example_purifier_no_obsolete_water'),
            "name": "智慧零冷水"
          },
          {
            "entity": entityId('select.example_purifier_hydration_setting'),
            "name": "补水设置"
          },
          {
            "entity": entityId('switch.example_purifier_wash'),
            "name": "滤芯冲洗"
          }
        ]
      }
    ],
    "brand": "美的"
  },
  "drinker": {
    "name": "管线机",
    "model": "COLMO CWG-DA05",
    "location": "厨房",
    "icon": "drinker",
    "primary": entityId('binary_sensor.example_guan_xian_ji_she_bei_zhuang_tai'),
    "availability": true,
    "groups": [
      {
        "title": "设备状态",
        "items": [
          {
            "entity": entityId('binary_sensor.example_guan_xian_ji_she_bei_zhuang_tai'),
            "name": "设备在线"
          },
          {
            "entity": entityId('sensor.example_guan_xian_ji_dang_qian_wen_du'),
            "name": "当前水温"
          },
          {
            "entity": entityId('sensor.example_guan_xian_ji_sha_jun_sheng_yu_shi_jian'),
            "name": "杀菌剩余时间"
          },
          {
            "entity": entityId('sensor.example_guan_xian_ji_sha_jun_dao_ji_shi'),
            "name": "杀菌提醒倒计时"
          }
        ]
      },
      {
        "title": "温度与定量",
        "items": [
          {
            "entity": entityId('number.example_guan_xian_ji_zi_ding_yi_wen_du_1'),
            "name": "自定义温度"
          },
          {
            "entity": entityId('select.example_guan_xian_ji_ding_liang_mo_shi'),
            "name": "出水定量模式"
          },
          {
            "entity": entityId('select.example_guan_xian_ji_ding_liang_1'),
            "name": "小杯定量（mL）"
          },
          {
            "entity": entityId('select.example_guan_xian_ji_ding_liang_2'),
            "name": "中杯定量（mL）"
          },
          {
            "entity": entityId('select.example_guan_xian_ji_ding_liang_3'),
            "name": "大杯定量（mL）"
          }
        ]
      },
      {
        "title": "日常设置",
        "items": [
          {
            "entity": entityId('lock.example_guan_xian_ji_tong_suo'),
            "name": "童锁"
          },
          {
            "entity": entityId('switch.example_guan_xian_ji_zhi_leng'),
            "name": "制冷"
          },
          {
            "entity": entityId('switch.example_guan_xian_ji_ren_ti_gan_ying'),
            "name": "感应亮屏"
          },
          {
            "entity": entityId('select.example_guan_xian_ji_xi_ping_shi_jian'),
            "name": "息屏时间（秒）"
          },
          {
            "entity": entityId('switch.example_guan_xian_ji_she_zhi_sha_jun_dao_ji_shi'),
            "name": "高温杀菌提醒"
          }
        ]
      },
      {
        "title": "清洁操作",
        "items": [
          {
            "entity": entityId('switch.example_guan_xian_ji_sha_jun'),
            "name": "高温杀菌"
          },
          {
            "entity": entityId('switch.example_guan_xian_ji_pai_shui'),
            "name": "一键排水"
          }
        ]
      }
    ],
    "brand": "COLMO"
  }
};

/** 判断 HA 实体是否有有效状态，数值零和关闭状态仍属于有效读数。 */
function valid(entity) {return !!entity&&!['unknown','unavailable',''].includes(entity.state)&&entity.state!==null&&entity.state!==undefined;}
/** 以原单位和可读开关文本展示设备状态，不将实体内容作为 HTML。 */
export function applianceReading(entity,hass) {
  if(!valid(entity))return '暂无数据';
  if(typeof hass?.formatEntityState==='function') {
    try {return String(hass.formatEntityState(entity));}
    catch(error) {console.warn('Appliance state formatting failed',error);}
  }
  const mapped={on:'开启',off:'关闭',locked:'已锁定',unlocked:'未锁定',locking:'正在锁定',unlocking:'正在解锁'};
  const unit=entity.attributes?.unit_of_measurement;
  return `${mapped[entity.state]??entity.state}${unit?' '+unit:''}`;
}
/** 读取原首页设备缓存，离线或连接中断时隐藏缓存值，冰箱不伪造真实实体。 */
export function applianceInformation(id,hass) {
  const definition=APPLIANCE_DEFINITIONS[id];if(!definition)return null;
  const states=hass?.states||{},primary=states[definition.primary];
  const configured=!!definition.primary&&!!primary;
  const available=!!hass&&hass.connected!==false&&valid(primary)&&(!definition.availability||primary.state==='on');
  const status=!definition.primary?'未接入':!hass?'未连接 HA':hass.connected===false?'连接中断':!configured?'未接入':available?'在线':'离线';
  const groups=definition.groups.map(group=>({...group,items:group.items.map(item=>({...item,value:available?applianceReading(states[item.entity],hass):'不可用'}))}));
  const reports=available?[primary,...definition.groups.flatMap(group=>group.items.map(item=>states[item.entity]))].filter(valid).map(entity=>entity.last_updated).filter(value=>value&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a)):[];
  return {...definition,available,status,reading:available?applianceReading(primary,hass):status,groups,reportedAt:reports[0]||null};
}
