"""批量更新 Options HTML：必填标记、目录分区、技能/紧急联系人列表、行业补充。"""
from pathlib import Path

path = Path(r"m:\项目\躺投\src\entrypoints\options\index.html")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        '<label class="field"><span class="field-label">国籍</span><input data-path="basic.nationality" type="text" placeholder="如：中国" /></label>',
        '<label class="field"><span class="field-label">国籍 <span class="req" aria-label="必填">*</span></span><select data-path="basic.nationality" data-catalog="nationality" required></select></label>',
    ),
    (
        '<label class="field"><span class="field-label">籍贯</span><input data-path="basic.nativePlace" type="text" /></label>',
        '<label class="field"><span class="field-label">籍贯 <span class="req" aria-label="必填">*</span></span><input data-path="basic.nativePlace" type="text" required /></label>',
    ),
    (
        '<label class="field"><span class="field-label">证件类型</span><select data-path="basic.idType" data-catalog="idType"></select></label>',
        '<label class="field"><span class="field-label">证件类型 <span class="req" aria-label="必填">*</span></span><select data-path="basic.idType" data-catalog="idType" required></select></label>',
    ),
    (
        '<label class="field"><span class="field-label">证件号码</span><input data-path="basic.idNumber" type="text" /></label>',
        '<label class="field"><span class="field-label">证件号码 <span class="req" aria-label="必填">*</span></span><input data-path="basic.idNumber" type="text" required /></label>',
    ),
    (
        '<label class="field"><span class="field-label">政治面貌</span><select data-path="basic.politicalStatus" data-catalog="political"></select></label>',
        '<label class="field"><span class="field-label">政治面貌 <span class="req" aria-label="必填">*</span></span><select data-path="basic.politicalStatus" data-catalog="political" required></select></label>',
    ),
    (
        '<label class="field"><span class="field-label">婚姻状况</span><select data-path="basic.maritalStatus" data-catalog="marital"></select></label>',
        '<label class="field"><span class="field-label">婚姻状况 <span class="req" aria-label="必填">*</span></span><select data-path="basic.maritalStatus" data-catalog="marital" required></select></label>',
    ),
    (
        '<label class="field"><span class="field-label">期望行业</span><input data-path="jobIntent.expectedIndustry" type="text" /></label>',
        '<label class="field"><span class="field-label">期望行业</span><select data-path="jobIntent.expectedIndustry" data-catalog="industry"></select></label>',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"MISSING: {old[:80]}")
    text = text.replace(old, new)

# 分区 id + TOC 布局
old_editor_start = """        <div class="editor-header">
          <h2 id="editorHeading">编辑档案</h2>
          <p id="editingProfileName" class="editing-name"></p>
        </div>
        <form id="profileEditorForm">
          <p id="editorValidationHint" class="hint" role="status"></p>
          <p class="req-legend">
            <span class="req-mark" aria-hidden="true">*</span>
            珊瑚色星号为硬必填；分区标题为青绿大标题；字段说明为灰色正文。日期精确到日。
          </p>

          <details class="editor-block" open>
            <summary>基本信息</summary>"""

new_editor_start = """        <div class="editor-header">
          <h2 id="editorHeading">编辑档案</h2>
          <p id="editingProfileName" class="editing-name"></p>
        </div>
        <div class="editor-layout">
          <nav class="editor-toc" aria-label="档案分区目录">
            <p class="editor-toc-title">目录</p>
            <ul id="editorTocList" class="editor-toc-list"></ul>
          </nav>
          <form id="profileEditorForm" class="editor-form">
          <p id="editorValidationHint" class="hint" role="status"></p>
          <p class="req-legend">
            <span class="req-mark" aria-hidden="true">*</span>
            珊瑚色星号为硬必填；分区标题为青绿大标题；字段说明为灰色正文。日期精确到日。
          </p>

          <details class="editor-block" open id="section-basic">
            <summary>基本信息</summary>"""

if old_editor_start not in text:
    raise SystemExit("MISSING editor start")
text = text.replace(old_editor_start, new_editor_start)

section_map = [
    ('<details class="editor-block" open>\n            <summary>求职意向</summary>',
     '<details class="editor-block" open id="section-jobIntent">\n            <summary>求职意向</summary>'),
    ('<details class="editor-block" open>\n            <summary>教育经历（至少一条完整）</summary>',
     '<details class="editor-block" open id="section-education">\n            <summary>教育经历（至少一条完整）</summary>'),
    ('<details class="editor-block" open>\n            <summary>实习 / 工作经历</summary>',
     '<details class="editor-block" open id="section-experience">\n            <summary>实习 / 工作经历</summary>'),
    ('<details class="editor-block" open>\n            <summary>项目经历</summary>',
     '<details class="editor-block" open id="section-projects">\n            <summary>项目经历</summary>'),
    ('<details class="editor-block">\n            <summary>校园 / 社团 / 志愿（可选）</summary>',
     '<details class="editor-block" id="section-campus">\n            <summary>校园 / 社团 / 志愿（可选）</summary>'),
    ('<details class="editor-block" open>\n            <summary>技能与计算机</summary>',
     '<details class="editor-block" open id="section-skills">\n            <summary>技能与计算机</summary>'),
    ('<details class="editor-block">\n            <summary>语言能力（可选）</summary>',
     '<details class="editor-block" id="section-language">\n            <summary>语言能力（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>证书 / 资格（可选）</summary>',
     '<details class="editor-block" id="section-certificate">\n            <summary>证书 / 资格（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>奖项荣誉（可选）</summary>',
     '<details class="editor-block" id="section-award">\n            <summary>奖项荣誉（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>论文 / 专利 / 著作（可选）</summary>',
     '<details class="editor-block" id="section-publication">\n            <summary>论文 / 专利 / 著作（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>培训经历（可选）</summary>',
     '<details class="editor-block" id="section-training">\n            <summary>培训经历（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>家庭成员（可选，银行/事业单位常见）</summary>',
     '<details class="editor-block" id="section-family">\n            <summary>家庭成员（可选，银行/事业单位常见）</summary>'),
    ('<details class="editor-block">\n            <summary>紧急联系人（可选）</summary>',
     '<details class="editor-block" id="section-emergency">\n            <summary>紧急联系人（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>体制 / 银行特殊项（可选）</summary>',
     '<details class="editor-block" id="section-specialOrg">\n            <summary>体制 / 银行特殊项（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>外企 / 工作许可（可选）</summary>',
     '<details class="editor-block" id="section-workAuth">\n            <summary>外企 / 工作许可（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>自定义问答素材（可选）</summary>',
     '<details class="editor-block" id="section-essays">\n            <summary>自定义问答素材（可选）</summary>'),
    ('<details class="editor-block">\n            <summary>附件备注（不存文件，可选）</summary>',
     '<details class="editor-block" id="section-attachment">\n            <summary>附件备注（不存文件，可选）</summary>'),
    ('<details class="editor-block" open>\n            <summary>自由补充</summary>',
     '<details class="editor-block" open id="section-notes">\n            <summary>自由补充</summary>'),
]

for old, new in section_map:
    if old not in text:
        raise SystemExit(f"MISSING section: {old[:60]}")
    text = text.replace(old, new)

old_skills = """          <details class="editor-block" open id="section-skills">
            <summary>技能与计算机</summary>
            <div class="form-grid">
              <label class="field"><span class="field-label">计算机水平</span><select data-path="computerLevel" data-catalog="computer"></select></label>
              <label class="field"><span class="field-label">办公软件</span><select data-path="officeSkillLevel" data-catalog="office"></select></label>
              <label class="field field-span-2">
                <span class="field-label">技能（每行一项）</span>
                <textarea id="skillsTextarea" rows="4" placeholder="TypeScript&#10;React"></textarea>
              </label>
            </div>
          </details>"""

new_skills = """          <details class="editor-block" open id="section-skills">
            <summary>技能与计算机</summary>
            <div class="form-grid">
              <label class="field"><span class="field-label">计算机水平</span><select data-path="computerLevel" data-catalog="computer"></select></label>
              <label class="field"><span class="field-label">办公软件</span><select data-path="officeSkillLevel" data-catalog="office"></select></label>
            </div>
            <div id="skillsList" class="item-list"></div>
            <button type="button" class="btn btn-ghost" data-add-list="skills">添加技能</button>
          </details>"""

if old_skills not in text:
    raise SystemExit("MISSING skills block")
text = text.replace(old_skills, new_skills)

old_emergency = """          <details class="editor-block" id="section-emergency">
            <summary>紧急联系人（可选）</summary>
            <div class="form-grid">
              <label class="field"><span class="field-label">姓名</span><input data-path="emergencyContact.name" type="text" /></label>
              <label class="field"><span class="field-label">关系</span><input data-path="emergencyContact.relationship" type="text" /></label>
              <label class="field"><span class="field-label">电话</span><input data-path="emergencyContact.phone" type="tel" /></label>
            </div>
          </details>"""

new_emergency = """          <details class="editor-block" id="section-emergency">
            <summary>紧急联系人（可选）</summary>
            <div id="emergencyList" class="item-list"></div>
            <button type="button" class="btn btn-ghost" data-add-list="emergency">添加紧急联系人</button>
          </details>"""

if old_emergency not in text:
    raise SystemExit("MISSING emergency")
text = text.replace(old_emergency, new_emergency)

old_special = """              <label class="field"><span class="field-label">委培/定向</span><input data-path="specialOrg.directedTraining" type="text" /></label>
            </div>
          </details>

          <details class="editor-block" id="section-workAuth">"""

new_special = """              <label class="field"><span class="field-label">委培/定向</span><input data-path="specialOrg.directedTraining" type="text" /></label>
              <label class="field field-span-2"><span class="field-label">基层服务经历</span><input data-path="specialOrg.grassrootsService" type="text" /></label>
              <label class="field field-span-2"><span class="field-label">公务员/事业编报考史</span><input data-path="specialOrg.civilServiceExamHistory" type="text" /></label>
            </div>
          </details>

          <details class="editor-block" id="section-workAuth">"""

if old_special not in text:
    raise SystemExit("MISSING special")
text = text.replace(old_special, new_special)

old_work = """              <label class="field"><span class="field-label">LinkedIn（外企）</span><input data-path="workAuth.linkedinUrl" type="url" /></label>
            </div>
          </details>

          <details class="editor-block" id="section-essays">"""

new_work = """              <label class="field"><span class="field-label">LinkedIn（外企）</span><input data-path="workAuth.linkedinUrl" type="url" /></label>
              <label class="field"><span class="field-label">英文简历链接</span><input data-path="workAuth.englishResumeUrl" type="url" /></label>
              <label class="field"><span class="field-label">护照国籍</span><input data-path="workAuth.passportNationality" type="text" /></label>
            </div>
          </details>

          <details class="editor-block" id="section-industry">
            <summary>行业补充（可选，按目标行业填写）</summary>
            <p class="hint">银行/医疗/教师/法律/互联网/制造/军工/实习等专项字段；不填不影响保存。</p>
            <div class="form-grid">
              <label class="field"><span class="field-label">接受柜面工作</span><select data-path="industryExtras.acceptCounterWork" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">接受调剂郊县</span><select data-path="industryExtras.acceptSuburbTransfer" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">风险合规承诺</span><select data-path="industryExtras.riskComplianceAck" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">亲友金融从业</span><select data-path="industryExtras.relativeInFinance" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">证券/基金从业资格</span><input data-path="industryExtras.securitiesFundCert" type="text" /></label>
              <label class="field"><span class="field-label">反洗钱培训</span><input data-path="industryExtras.amlTraining" type="text" /></label>
              <label class="field"><span class="field-label">执业资格证</span><input data-path="industryExtras.medicalLicense" type="text" /></label>
              <label class="field"><span class="field-label">规培情况</span><input data-path="industryExtras.residencyTraining" type="text" /></label>
              <label class="field"><span class="field-label">意向科室</span><input data-path="industryExtras.departmentIntent" type="text" /></label>
              <label class="field"><span class="field-label">接受夜班</span><select data-path="industryExtras.acceptNightShift" data-catalog="yesNo"></select></label>
              <label class="field field-span-2"><span class="field-label">传染病史声明</span><input data-path="industryExtras.infectiousDiseaseNote" type="text" /></label>
              <label class="field"><span class="field-label">教资学段</span><input data-path="industryExtras.teacherCertStage" type="text" /></label>
              <label class="field"><span class="field-label">教资学科</span><input data-path="industryExtras.teacherCertSubject" type="text" /></label>
              <label class="field"><span class="field-label">普通话等级</span><select data-path="industryExtras.mandarinLevel" data-catalog="mandarin"></select></label>
              <label class="field"><span class="field-label">教资笔面试状态</span><input data-path="industryExtras.teacherExamStatus" type="text" /></label>
              <label class="field"><span class="field-label">法考情况</span><input data-path="industryExtras.judicialExam" type="text" /></label>
              <label class="field"><span class="field-label">执业方向</span><input data-path="industryExtras.lawPracticeArea" type="text" /></label>
              <label class="field field-span-2"><span class="field-label">律所/法院实习</span><input data-path="industryExtras.lawFirmCourtIntern" type="text" /></label>
              <label class="field field-span-2"><span class="field-label">开源贡献</span><input data-path="industryExtras.openSourceContrib" type="text" /></label>
              <label class="field"><span class="field-label">技术博客</span><input data-path="industryExtras.techBlogUrl" type="url" /></label>
              <label class="field"><span class="field-label">驾照准驾</span><select data-path="industryExtras.driverLicenseType" data-catalog="driver"></select></label>
              <label class="field"><span class="field-label">特种作业证</span><input data-path="industryExtras.specialOperationCert" type="text" /></label>
              <label class="field"><span class="field-label">接受倒班</span><select data-path="industryExtras.acceptShiftWork" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">接受出差驻场</span><select data-path="industryExtras.acceptOnsiteTravel" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">政审意愿</span><select data-path="industryExtras.politicalReviewWilling" data-catalog="yesNo"></select></label>
              <label class="field field-span-2"><span class="field-label">涉密经历声明</span><input data-path="industryExtras.classifiedWorkNote" type="text" /></label>
              <label class="field"><span class="field-label">周到岗天数</span><input data-path="industryExtras.weeklyOnsiteDays" type="text" /></label>
              <label class="field"><span class="field-label">实习是否可转正</span><select data-path="industryExtras.internToFullTime" data-catalog="yesNo"></select></label>
              <label class="field"><span class="field-label">实习时长(月)</span><input data-path="industryExtras.internDurationMonths" type="text" /></label>
            </div>
          </details>

          <details class="editor-block" id="section-essays">"""

if old_work not in text:
    raise SystemExit("MISSING workAuth end")
text = text.replace(old_work, new_work)

# 关闭 editor-layout
old_end = """          <div class="button-row">
            <button type="submit" class="btn btn-primary">保存档案</button>
            <button type="button" id="closeEditorButton" class="btn btn-secondary">关闭编辑</button>
          </div>
        </form>
      </section>"""

new_end = """          <div class="button-row">
            <button type="submit" class="btn btn-primary">保存档案</button>
            <button type="button" id="closeEditorButton" class="btn btn-secondary">关闭编辑</button>
          </div>
          </form>
        </div>
      </section>"""

if old_end not in text:
    raise SystemExit("MISSING form end")
text = text.replace(old_end, new_end)

path.write_text(text, encoding="utf-8")
print("options HTML updated OK")
