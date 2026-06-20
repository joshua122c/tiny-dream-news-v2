const ENTITY_DISPLAY_NAMES = new Map([
  ["Federal Reserve", "聯準會"],
  ["Fed", "聯準會"],
  ["Inflation", "通膨"],
  ["Interest Rates", "利率"],
  ["US Dollar", "美元"],
  ["Dollar", "美元"],
  ["Oil", "油價"],
  ["Crude Oil", "原油"],
  ["Gold", "金價"],
  ["Nasdaq", "Nasdaq"],
  ["S&P 500", "S&P 500"],
  ["Nvidia", "Nvidia"],
  ["TSMC", "台積電"],
  ["Bitcoin", "Bitcoin"],
]);

const CATEGORY_DISPLAY_NAMES = new Map([
  ["美股", "美股"],
  ["港股", "港股"],
  ["中概", "中概股"],
  ["AI", "AI"],
  ["半導體", "半導體"],
  ["宏觀", "宏觀"],
  ["加密", "加密資產"],
  ["外匯", "外匯"],
  ["商品", "商品"],
  ["地緣政治", "地緣政治"],
  ["企業財報", "企業財報"],
  ["科技公司", "科技公司"],
]);

const PHRASE_REPLACEMENTS = [
  [/霍尔木兹/g, "霍爾木茲"],
  [/海峡/g, "海峽"],
  [/通过/g, "通過"],
  [/准备/g, "準備"],
  [/原油/g, "原油"],
  [/市场/g, "市場"],
  [/美国/g, "美國"],
  [/中国/g, "中國"],
  [/经济/g, "經濟"],
  [/货币/g, "貨幣"],
  [/投资/g, "投資"],
  [/风险/g, "風險"],
  [/万/g, "萬"],
  [/联储|美联储/g, "聯準會"],
  [/通胀/g, "通膨"],
  [/利率/g, "利率"],
  [/债/g, "債"],
  [/预/g, "預"],
  [/津巴布韦/g, "津巴布韋"],
  [/锂/g, "鋰"],
  [/联合/g, "聯合"],
  [/申请/g, "申請"],
  [/推迟/g, "推遲"],
  [/精矿/g, "精礦"],
  [/仅/g, "僅"],
  [/华友/g, "華友"],
  [/钴/g, "鈷"],
  [/业/g, "業"],
  [/产线/g, "產線"],
];

const BAD_HEADLINE_PATTERNS = [
  /^重點主題[：:]/,
  /^cluster_title_candidate$/i,
  /^\?/,
  /[\uE000-\uF8FF\uFFFD]/,
  /銝|嚗|蝺|瘝|閫|餈|憿|摰/,
];

const COMMON_SIMPLIFIED_CHARS = /[万与东丝两严丧个丰临为丽举么义乌乐乔习乡书买乱争于亏云亚产亩亲亿仅从仑仓仪们价众优会伞伟传伤伦伪体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偬偻偾偿傥傧储傩儿兑兖兰关兴兹养兽冁内冈册写军农冯冲决况冻净凄准凉减凑凛凤凭凯击凿刍划刘则刚创删别刬刭刹刽刿剀剂剐剑剥剧劝办务劢动励劲劳势勋勐勚匀匦匮区医华协单卖卢卫却卺厂厅历厉压厌厍厕厢县叁参双发变叙叠叶号叹叽吁后吓吕吗吣吨听启吴呐呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唤啧啬啭啮啴啸喷喽喾嗫嗳嘘嘤嘱噜嚣团园囱围囵国图圆圣圹场坏块坚坛坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲垴埘埙埚埯堑堕墙壮声壳壶壸处备复够头夹夺奁奂奋奖奥妆妇妈妩妪妫姗姜娄娅娆娇娈娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岙岚岛岭岳岽岿峃峡峣峤峥峦崂崃崄崭嵘嵚嵝巅巩巯币帅师帏帐帘帜带帧帮帱帻帼幂庄庆庐庑库应庙庞废庼廪开异弃张弥弪弯弹强归当录彦彻径徕御忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恒恳恶恸恹恺恻恼恽悦悫悬悭悮悯惊惧惨惩惫惬惭惮惯愠愤愦愿慑懑懒懔戆戋戏戗战戬户扎扑托执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺揽揾揿搀搁搂搅携摄摆摇摈摊撄撑撵撷撸撺擞攒敌敛数斋斓斗斩断无旧时旷旸昙昼显晋晒晓晔晕晖暂暧术朴机杀杂权条来杨杩杰极构枞枢枣枪枫枭柜柠柽栀栅标栈栉栋栌栎栏树栖样栾桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椤椭楼榄榇榈榉槚槛槟槠横樯樱橥橱橹橼檩欢欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氇气氢氩氲汇汉污汤汹沟没沣沤沥沦沧沪泞注泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浊测浍济浏浐浑浒浓浔涛涝涞涟涠涡涣涤润涧涨涩淀渊渌渍渎渐渔渖渗温湾湿溃溅溆滗滚滞滟滠满滢滤滥滦滨滩滪漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牦牵牺犊状犷犸犹狈狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玛玮环现玱玺珐珑珰珲琎琏琐琼瑶瑷璇璎瓒瓯电画畅畴疖疗疟疠疡疬疮疯疱疴痈痉痒痨痪痫瘅瘆瘗瘘瘪瘫瘾瘿癞癣皑皱皲盏盐监盖盗盘眍眦着睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硅硕硖硗硙硚确硷碍碛碜碱礼祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹签简箓箦箧箨箩箪箫篑篓篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纵纶纷纸纹纺纽纾线绀绁绂练组绅细织终绉绊绍绎经绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绥绦继绩绪绫续绮绯绰绱绲绳维绵绶绷绸综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缓缔缕编缘缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缴缵罂网罗罚罢罴羁羟羡翘耧耸耻聂聋职联聩聪肃肠肤肮肴肾肿胀胁胆胜胡胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腊腘腻腼腾膑臜舆舣舰舱艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏苹范茎茏茑茔茕茧荆荐荙荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莱莲莳莴莶获莸莹莺莼萚萝萤营萦萧萨葱蒇蒉蒋蒌蓝蓟蓠蓣蓥蓦蔷蔹蔺蔼蕲蕴薮藓虏虑虚虫虬虮虽虾虿蚀蚁蚂蚕蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蜡蝇蝈蝉蝎蝼蝾螀螨蟏衅衔补衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襁襕见观规觅视觇览觉觊觋觌觎觏觐觑觞触觯誉誊讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谰谱谲谳谴谵谶贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贷贸费贺贻贼贽贾贿赀赁赂赃资赅赇赈赉赊赋赌赍赎赏赐赔赖赗赘赙赚赛赞赠赡赢赣赵赶趋趱趸跃跄跞践跶跷跸跹跻踊踌踪踬踯蹑蹒蹰蹿躏躜车轧轨轩轫转轭轮软轰轱轲轳轴轵轶轸轹轻轼载轾轿辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑输辔辕辖辗辘辙辚辞辟辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逦逻遗遥邓邝邬邮邹邺邻郁郄郏郐郑郓郦郧郸酝酦酱酽酾酿释里鉴銮錾钅钆钇针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铙铛铜铝铞铟铠铡铢铣铤铥铦铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锃锄锅锆锈锉锋锌锏锐锑锒锓锔锕锖锗错锚锛锜锞锟锡锢锣锤锥锦锨锩锭键锯锰锱锲锵锶锷锸锹锺锻锼锾锿镀镁镂镇镉镊镌镍镏镐镑镒镓镔镖镗镘镙镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳镴镶长门闩闪闫闭问闯闰闲间闵闷闸闹闺闻闼闽闾阀阁阂阃阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阘阙阚队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉静靥鞑鞒鞯韦韧韩韪韫韵页顶顷项顺须顼顽顾顿颀颁颂预颅领颇颈颉颊颌颍颎颏频颓颖颗题额颚颛颜额颞颟颠颡颢飐飒飓飔飘飙飞饣饥饧饨饩饪饫饬饭饮饯饰饱饲饴饵饶饷饸饹饺饼饽饿馁馂馅馆馈馊馋馍馏馐馑馒馓马驭驮驯驰驱驳驴驶驷驸驹驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骐骑骒骓骖骗骘骚骛骜鱼鱿鲁鲂鲅鲆鲇鲈鲋鲎鲐鲑鲒鲔鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鳄鳅鳆鳇鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳞鳟鳢鸟鸠鸡鸢鸣鸥鸦鸧鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹏鹐鹑鹕鹗鹘鹚鹛鹜鹞鹣鹤鹦鹧鹨鹩鹪鹫鹬鹭鹮鹯鹰鹱鹳鹾麦麸黄黉黡黩黪黾鼋鼍鼗鼹齐齑齿龀龁龂龄龅龆龇龈龉龊龋龌龙龚龛龟]/;

export function toDisplayZhHant(value) {
  let text = String(value ?? "").trim();
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function hasCommonSimplifiedChars(value) {
  return /[万与专业东丝丛两严丧个临为丽举义乌乐乔习乡书买乱争亚产亩亲亿仅仑仓仪们价众优伞伟传伤伦伪体佣侣侦侧侨侩俩俪俭债倾偿储兑兰关兴养兽冈册写军农冲决况冻净准凉减凑凤凭凯击凿划刘则刚创删别刽剂剑剥剧劝办务动励劲劳势勋区医华协单卖卢卫厂厅历厉压厌县参双发变叠号叹听启吗吨员呛呜响哑哗唤啧啬啭啮啸喷团园围国图圆场坏块坚坛坝坟坠垄垒垦垫墙壮声壳处备复头夹夺奋奖奥妆妇妈娇娴婴婵孙学宁宝实宠审宫宽宾寝对寻导寿将尘尝尽层屉属屡岁岂岖岗岚岛岭峡峦崭巅币帅师帐帜带帮庄庆库应庙庞废开异弃张弯弹强归当录忆忧怀态怂怜总恶恼悦惊惧惨惩惯愤愿懒戏战扑执扩扫扬扰抚抛抠抢护报担拟拢拣拥拦拧拨择挂挠挡挣挤挥捞损捡换捣掳掷掺揽搁搂搅携摄摆摇摊撑敌敛数斋斩断无旧时旷昼显晒晓晕暂术机杀杂权条来杰极构枢枣枪枫柜标栈栋栏树样档桥桦桧桨桩梦检楼榄榈槛横樱橱欢欧残殒殴毁毕毙气汇汉汤沟沥沦沧沪泞泪泷泸泻泼泽洁浅浆浇浊测济浏浑浓涛涝涟涡涤润涧涨涩渊渍渐渔渗温湾湿溃溅滚滞满滤滥滦滨滩潇澜灭灯灵灾灿炉点炼烁烂烛烟烦烧烩烫热爱牵状犹狈狭狮独狱猎猫玛环现玺珑琐电画畅疗疮疯痈痉痒痨痪痫瘫皱盏盐监盖盗盘睁睐睑瞒瞩矫矿码砖砚碍碱礼祷祸禅离积称稳穷窃窍窑窜窝窥竖竞笃笔笺笼筹签简类粮紧纠红纤约级纪纬纯纱纲纳纵纷纸纹纺纽线练组细织终绍经绑绕绘给绝统绢绣继绩绪续绰绳维绵绷绸综绽绿缀缅缆缇缉缓缔缕编缘缚缝缠缤缩缴网罗罚罢羁翘耸耻聂职聪肃肠肤肿胀胆胧胪胶脉脏脐脑脓脚脱脸腻腾舆舰舱艰艳艺节芜芦苇苏苹范茎茏苍荐荚荞荟荡荣荤荧药莱莲获莹营萧萨蓝蔷虑虚虽虾蚁蚂蚕蛊蛮蛰蜗蝇蝉衅衔补衬袜袭装裤见观规视览觉触誉认计订讨让讪训议讯记讲讳讴讶许论设访诀证评识诉词试诗诚话诞诠询该详诧语误诱诲请诸诺读课调谈谊谋谐谓谜谢谣谦谨谱贝负贡财责败账货质贩贫购贵贷贸费贺贼贾贿赁赂资赋赌赏赐赔赖赚赛赞赠赢赵赶趋跃践踊踪车轧轨轩转轮软轰轴轻载较辅辆辈辉辑输辖辗辘辞辩边辽达迁过迈运还这进远违连迟适选递遗邓邮邻郑释鉴钢钱钻铁铃铅铜铝银铺链销锁锅锋锐错锚锡锣锦键锯锰镜长门问闯闲间闷闹闻阀阁阅队阳阴阵阶际陆陈陕陨险随隐难雾韦韩页顶项顺须顾顿颁颂预领颇频题额颜颠飞饥饭饮饰饱饶馆馋马驰驱驶验骏骑骗骚鱼鲁鲜鸟鸡鸣鸦鸭鸳鹏鹤鹰麦黄齐齿龙龟]/.test(String(value ?? ""));
}

export function hasBadUserFacingText(value) {
  return BAD_HEADLINE_PATTERNS.some((pattern) => pattern.test(String(value ?? "")));
}

export function hasMostlyEnglishText(value, { minLetters = 14, minCjk = 4 } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  const asciiLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const cjkChars = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return asciiLetters >= minLetters && cjkChars < minCjk;
}

export function displayEntityName(name) {
  const text = String(name ?? "").trim();
  return ENTITY_DISPLAY_NAMES.get(text) ?? toDisplayZhHant(text);
}

export function displayCategoryName(name) {
  const text = String(name ?? "").trim();
  return CATEGORY_DISPLAY_NAMES.get(text) ?? toDisplayZhHant(text);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function relatedAssetsForDisplay(cluster, limit = 4) {
  const fromAssets = asArray(cluster.related_assets);
  const fromEntities = asArray(cluster.detected_entities).map((entity) => entity.name);
  return unique([...fromAssets, ...fromEntities].map(displayEntityName)).slice(0, limit);
}

export function categoriesForDisplay(cluster, limit = 3) {
  return unique(asArray(cluster.categories).map(displayCategoryName)).slice(0, limit);
}

function sourceText(cluster) {
  return [
    cluster.cluster_title_candidate,
    ...asArray(cluster.articles).flatMap((article) => [article.title, article.snippet]),
    ...relatedAssetsForDisplay(cluster, 8),
    ...categoriesForDisplay(cluster, 8),
  ]
    .filter(Boolean)
    .join(" ");
}

function cleanedChineseCandidate(cluster) {
  const candidates = [cluster.cluster_title_candidate, ...asArray(cluster.articles).map((article) => article.title)]
    .map((original) => ({
      original: String(original ?? "").trim(),
      cleaned: toDisplayZhHant(original),
    }))
    .filter(
      ({ original, cleaned }) =>
        cleaned !== original && /[\u3400-\u9fff]/.test(cleaned) && !hasBadUserFacingText(cleaned) && !hasCommonSimplifiedChars(cleaned),
    )
    .map(({ cleaned }) => cleaned);
  return candidates[0] ?? "";
}

export function isBadUserFacingHeadline(headline, cluster = null) {
  const text = String(headline ?? "").trim();
  if (!text) return true;
  if (hasBadUserFacingText(text)) return true;
  if (hasMostlyEnglishText(text)) return true;
  if (cluster?.cluster_title_candidate && text === cluster.cluster_title_candidate) return true;
  if (cluster?.debug?.cluster_title_candidate && text === cluster.debug.cluster_title_candidate) return true;
  const assets = relatedAssetsForDisplay(cluster ?? {}, 8).join("|");
  const categories = categoriesForDisplay(cluster ?? {}, 8).join("|");
  if (text === assets || text === categories || text === `${categories}｜${assets}`) return true;
  return false;
}

export function buildEditorialHeadline(cluster) {
  const text = sourceText(cluster).toLowerCase();
  const assets = relatedAssetsForDisplay(cluster, 3);
  const categories = categoriesForDisplay(cluster, 3);
  const chineseCandidate = cleanedChineseCandidate(cluster);

  if (text.includes("hormuz") || text.includes("iran") || text.includes("原油") || text.includes("oil")) {
    return "油價受霍爾木茲海峽與地緣局勢牽動";
  }
  if (text.includes("spacex") && text.includes("amazon")) {
    return "SpaceX 市值變化引發科技股估值關注";
  }
  if (
    text.includes("fed") ||
    text.includes("federal reserve") ||
    text.includes("inflation") ||
    text.includes("warsh") ||
    text.includes("聯準會") ||
    text.includes("通膨") ||
    text.includes("利率")
  ) {
    return "聯準會政策路徑與通膨訊號牽動市場情緒";
  }
  if (text.includes("dollar") || text.includes("us dollar") || text.includes("美元")) {
    return "美元走勢牽動外匯與宏觀市場焦點";
  }
  if (text.includes("nvidia") || text.includes("tsmc") || text.includes("semiconductor") || text.includes("ai")) {
    return "AI 與半導體供應鏈動向受市場關注";
  }
  if (text.includes("bitcoin") || text.includes("crypto") || text.includes("加密")) {
    return "加密資產波動升溫，市場關注風險偏好";
  }
  if (text.includes("gold") || text.includes("金價")) {
    return "金價受避險需求與利率預期影響";
  }
  if (text.includes("earnings") || text.includes("revenue") || text.includes("財報")) {
    return `${assets[0] ?? "企業"}財報與展望成為市場焦點`;
  }
  if (chineseCandidate && chineseCandidate.length <= 34) {
    return chineseCandidate.replace(/[，,。.]$/, "");
  }

  const subject = assets.length > 0 ? assets.slice(0, 2).join("、") : categories[0] ?? "市場";
  const theme = categories.length > 0 ? categories.slice(0, 2).join("、") : "全球市場";
  return `${subject}相關消息升溫，${theme}成為焦點`;
}

export function ensureEditorialHeadline(cluster) {
  return isBadUserFacingHeadline(cluster.headline_zh_hant, cluster) ? buildEditorialHeadline(cluster) : toDisplayZhHant(cluster.headline_zh_hant);
}

export function buildBriefReason(clusterOrItem) {
  const categories = categoriesForDisplay(clusterOrItem, 2);
  const assets = relatedAssetsForDisplay(clusterOrItem, 2);
  const subject = assets.length > 0 ? assets.join("、") : categories.join("、") || "此主題";
  const heatScore = Number(clusterOrItem.heat_score ?? 0);
  const heatText = heatScore > 0 ? `熱度分數 ${heatScore.toFixed(1)}，` : "";
  return `${subject} 涉及 ${categories.join("、") || "主要市場"}，${heatText}反映多個來源共同關注。`;
}

export function buildMorningBrief(topClusters, moodLabel) {
  const clusters = asArray(topClusters).slice(0, 10);
  const topHeadlines = clusters.slice(0, 5).map((cluster) => ensureEditorialHeadline(cluster));
  const categories = unique(clusters.flatMap((cluster) => categoriesForDisplay(cluster, 3))).slice(0, 6);
  const dominantThemes = categories.length > 0 ? categories.join("、") : "全球金融與科技市場";
  const leadingStories = topHeadlines.slice(0, 3).join("；");
  const mood = moodLabel || "訊號偏混合";

  return [
    `今日市場主線集中在${dominantThemes}。`,
    leadingStories
      ? `較受關注的題材包括${leadingStories}。`
      : "目前公開資訊有限，主要題材仍需更多來源確認。",
    `整體市場情緒呈現${mood}，資金仍在評估政策、企業消息與風險事件的交互影響。`,
    "後續可留意高熱度主題是否獲更多來源確認，以及相關資產與政策訊號是否出現新的公開資訊。",
  ].join("");
}
