(function(){
 const labels={RUN:'Работа',PLANNED_CIP:'Плановая CIP',DOWNTIME:'Простой',UNKNOWN:'Неизвестно',OUT_OF_PLAN:'Вне плана'};
 const rows=[['08:00','08:10','RUN',10],['08:10','08:30','PLANNED_CIP',20],['08:30','08:38','DOWNTIME',8],['08:38','08:50','RUN',12],['08:50','08:55','DOWNTIME',5],['08:55','09:00','RUN',5],['09:00','09:02','DOWNTIME',2],['09:02','09:10','RUN',8],['09:10','09:14','UNKNOWN',4],['09:14','09:20','RUN',6],['09:20','09:30','OUT_OF_PLAN',10]];
 const totals=Object.fromEntries(Object.keys(labels).map(k=>[k,0]));rows.forEach(r=>totals[r[2]]+=r[3]);
 document.getElementById('timeBalance').innerHTML=Object.entries(totals).map(([k,v])=>`<div class="time-item"><strong>${v} мин</strong><span>${labels[k]}</span></div>`).join('');
 document.getElementById('balanceResult').textContent=`Баланс проверен: ${Object.values(totals).reduce((a,b)=>a+b,0)} из 90 минут. Данные учебные.`;
 document.querySelector('#intervalTable tbody').innerHTML=rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${labels[r[2]]}</td><td>${r[3]}</td></tr>`).join('');
 document.getElementById('exportIntervalsBtn').addEventListener('click',()=>{const csv='\ufeffНачало МСК,Окончание МСК,Категория,Минуты\r\n'+rows.map(r=>[r[0],r[1],labels[r[2]],r[3]].join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='cip-uchebnye-intervaly.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
})();
