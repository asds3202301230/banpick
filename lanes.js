// 라인별 챔피언 목록 (Data Dragon 챔피언 ID 기준, 대략적인 분류입니다)
// 신규 챔피언이나 메타 변경은 아래 목록에 ID를 추가/삭제하면 됩니다.
window.LANES = {
  TOP: 'Aatrox Ambessa Aurora Camille Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce KSante Kayle Kennen Kled Lillia Malphite Maokai MonkeyKing Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Rengar Riven Rumble Sett Shen Singed Sion Smolder TahmKench Teemo Trundle Tryndamere Udyr Urgot Vayne Vladimir Volibear Warwick Yasuo Yone Yorick Akali Zac'.split(' '),
  JG: 'Amumu Belveth Briar Diana Ekko Elise Evelynn Fiddlesticks Gragas Graves Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia Maokai MasterYi Naafiri Nidalee Nocturne Nunu Olaf Poppy Rammus RekSai Rengar Sejuani Shaco Shyvana Skarner Taliyah Talon Trundle Udyr Vi Viego Volibear Warwick MonkeyKing XinZhao Zac Zyra'.split(' '),
  MID: 'Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Brand Cassiopeia Corki Diana Ekko Fizz Galio Heimerdinger Hwei Irelia Jayce Kassadin Katarina Kayle Kennen Leblanc Lissandra Lux Malzahar Mel Naafiri Neeko Orianna Pantheon Qiyana Ryze Seraphine Swain Sylas Syndra Taliyah Talon TwistedFate Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zilean Zoe Tristana Karma Karthus'.split(' '),
  ADC: 'Aphelios Ashe Caitlyn Corki Draven Ezreal Jhin Jinx Kaisa Kalista KogMaw Lucian MissFortune Nilah Samira Senna Sivir Smolder Tristana Twitch Varus Vayne Xayah Yunara Zeri Ziggs'.split(' '),
  SUP: 'Alistar Annie Ashe Bard Blitzcrank Brand Braum Galio Heimerdinger Janna Karma Leona Lulu Lux Malphite Maokai Mel Milio Morgana Nami Nautilus Neeko Pantheon Poppy Pyke Rakan Rell Renata Senna Seraphine Shaco Sona Soraka Swain TahmKench Taric Thresh Velkoz Xerath Yuumi Zilean Zyra'.split(' '),
};
