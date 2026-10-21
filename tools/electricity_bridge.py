"""生成把 hass-state-grid 实体映射为 smart-utilities-card-ele 属性结构的模板传感器。"""

import json
import sys

ACCOUNTS = {
    'example': 'sensor.example_state_grid_account'
}

# 日记录：倒序（最新在前），去掉尚未发布的空日期；电费仅在上游提供时输出。
DAYLIST = """{%- set ns = namespace(items=[]) -%}
{%- for d in (state_attr('P_previous_daily_usage', 'daily_history') or []) | reverse if d.usage is not none -%}
{%- set item = {'day': d.day, 'dayEleNum': d.usage, 'dayTPq': d.tip or 0, 'dayPPq': d.peak or 0, 'dayNPq': d.flat or 0, 'dayVPq': d.valley or 0} -%}
{%- if d.charge is not none -%}{%- set item = dict(item, dayEleCost=d.charge) -%}{%- endif -%}
{%- set ns.items = ns.items + [item] -%}
{%- endfor -%}
{{ ns.items }}"""

# 月记录：结算账单 + 本月累计；峰谷拆分仅在有日数据覆盖的月份按日汇总，本月不填电费。
MONTHLIST = """{%- set days = (state_attr('P_previous_daily_usage', 'daily_history') or []) | selectattr('usage', 'ne', none) | list -%}
{%- set bills = state_attr('P_previous_settled_month_usage', 'monthly_bill_history') or [] -%}
{%- set current = now().strftime('%Y-%m') -%}
{%- set ns = namespace(items=[]) -%}
{%- set rows = bills | list -%}
{%- if is_number(states('P_current_month_usage')) and current not in (bills | map(attribute='month') | list) -%}
{%- set rows = rows + [{'month': current, 'usage': states('P_current_month_usage') | float, 'charge': none}] -%}
{%- endif -%}
{%- for b in rows | sort(attribute='month', reverse=true) if b.usage is not none -%}
{%- set item = {'month': b.month, 'monthEleNum': b.usage} -%}
{%- if b.charge is not none -%}{%- set item = dict(item, monthEleCost=b.charge) -%}{%- endif -%}
{%- set md = days | selectattr('day', 'search', '^' ~ b.month) | list -%}
{%- if md | count > 0 -%}
{%- set item = dict(item,
  monthTPq=(md | map(attribute='tip') | reject('none') | sum | round(2)),
  monthPPq=(md | map(attribute='peak') | reject('none') | sum | round(2)),
  monthNPq=(md | map(attribute='flat') | reject('none') | sum | round(2)),
  monthVPq=(md | map(attribute='valley') | reject('none') | sum | round(2))) -%}
{%- endif -%}
{%- set ns.items = ns.items + [item] -%}
{%- endfor -%}
{{ ns.items }}"""

YEARLIST = """{%- set usage = states('P_current_year_usage') -%}
{%- set charge = states('P_current_year_charge') -%}
{%- set year = state_attr('P_current_year_usage', 'billing_year') -%}
{%- if is_number(usage) and is_number(charge) and year is not none -%}
{{ [{'year': year | string, 'yearEleNum': usage | float, 'yearEleCost': charge | float}] }}
{%- else -%}
{{ [] }}
{%- endif -%}"""

# 预付费显示余额，后付费显示上一结算月电费（卡片对应「上月电费」标签）。
STATE = """{%- if state_attr('P_account_balance', 'account_type') == 'prepaid' -%}
{{ states('P_account_balance') }}
{%- else -%}
{{ states('P_previous_settled_month_charge') }}
{%- endif -%}"""

AVAILABILITY = """{%- if state_attr('P_account_balance', 'account_type') == 'prepaid' -%}
{{ is_number(states('P_account_balance')) }}
{%- else -%}
{{ is_number(states('P_previous_settled_month_charge')) }}
{%- endif -%}"""

PREPAID = """{{ '是' if state_attr('P_account_balance', 'account_type') == 'prepaid' else '否' }}"""

# 平均单价来自上一结算月真实账单（电费 / 电量），不估算阶梯电价。
PRICING = """{%- set usage = states('P_previous_settled_month_usage') -%}
{%- set charge = states('P_previous_settled_month_charge') -%}
{%- if is_number(usage) and is_number(charge) and usage | float > 0 -%}
{{ {'计费标准': '平均单价', '平均单价': (charge | float / usage | float) | round(4)} }}
{%- else -%}
{{ none }}
{%- endif -%}"""

# 卡片标注为「预估使用」：余额 / 上一结算月日均电费。
REMAIN_DAYS = """{%- set balance = states('P_account_balance') -%}
{%- set charge = states('P_previous_settled_month_charge') -%}
{%- set month = state_attr('P_previous_settled_month_usage', 'latest_bill_month') -%}
{%- if is_number(balance) and is_number(charge) and charge | float > 0 and month -%}
{%- set start = strptime(month ~ '-01', '%Y-%m-%d') -%}
{%- set next_month = (start + timedelta(days=32)).replace(day=1) -%}
{%- set days = (next_month - start).days -%}
{{ (balance | float / (charge | float / days)) | round(0) | int }}
{%- else -%}
{{ none }}
{%- endif -%}"""

DATE = """{{ state_attr('P_account_balance', 'balance_date') or '' }}"""


def render(template, prefix):
    """把模板中的 P_ 占位符替换为指定户号的实体前缀。"""
    return template.replace("'P_", "'" + prefix + "_")


def sensor_config(suffix, prefix):
    """生成单个户号的桥接模板传感器配置。"""
    return {
        "name": "国网电力卡片 " + suffix,
        "unique_id": "state_grid_card_bridge_" + suffix,
        "icon": "mdi:flash",
        "unit_of_measurement": "CNY",
        "availability": render(AVAILABILITY, prefix),
        "state": render(STATE, prefix),
        "attributes": {
            "daylist": render(DAYLIST, prefix),
            "monthlist": render(MONTHLIST, prefix),
            "yearlist": render(YEARLIST, prefix),
            "预付费": render(PREPAID, prefix),
            "计费标准": render(PRICING, prefix),
            "剩余天数": render(REMAIN_DAYS, prefix),
            "date": render(DATE, prefix),
            "account_suffix": suffix,
        },
    }


def all_sensors():
    """生成全部户号的桥接传感器配置。"""
    return [sensor_config(suffix, prefix) for suffix, prefix in ACCOUNTS.items()]


if __name__ == "__main__":
    json.dump(all_sensors(), sys.stdout, ensure_ascii=False, indent=2)
