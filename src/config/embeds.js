const path = require('path');

const imagesDir = path.join(__dirname, '..', 'assets', 'images');

module.exports = {
  // Caminhos locais absolutos para uso com AttachmentBuilder
  assets: {
    ticketsBanner: path.join(imagesDir, 'tickets_banner.png'),
    recruitmentBanner: path.join(imagesDir, 'recruitment_banner.png'),
    pontoBanner: path.join(imagesDir, 'ponto_banner.png'),
    lspdBadge: path.join(imagesDir, 'lspd_badge.png'),
  },

  // Configurações globais de design
  design: {
    colors: {
      primary: '#1B52F1',   // Azul Tático
      success: '#00E676',   // Verde Sucesso
      danger: '#D50000',    // Vermelho Crítico/Erro/Saída
      warning: '#FFAB00',   // Amarelo Alerta/Espera
      dark: '#111625',      // Grafite Escuro Tático
    },
    logo: 'attachment://lspd_badge.png',
    banner: 'attachment://tickets_banner.png',
  },

  tickets: {
    panel: {
      color: '#1B52F1',
      author: {
        name: 'SSP • CENTRAL DE ATENDIMENTO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '🚨 CENTRAL DE ATENDIMENTO AO CIDADÃO',
      description: '━━━━━━━ Ocorrências, Denúncias e Suporte Geral ━━━━━━━\n\n' +
        'Bem-vindo ao canal seguro de comunicações da **SSP**. Este terminal eletrônico direciona o seu chamado diretamente para a divisão responsável.\n\n' +
        '**Selecione o departamento no menu suspenso abaixo:**\n' +
        '🚨 *Denúncia Anônima:* Reportar infrações e crimes de forma segura.\n' +
        '💡 *Dúvidas / Recrutamento:* Esclarecimentos gerais ou sobre a academia.\n' +
        '📝 *Atualização de Registro:* Mudança de nome, idade ou passaporte no RP.\n' +
        '⚖️ *Assuntos Internos:* Canal restrito da Corregedoria de Polícia.\n\n' +
        '⚠️ **AVISO LEGAL:** *A abertura de chamados fraudulentos ou o abuso deste terminal constitui crime de obstrução da justiça e resultará em prisão imediata.*',
      thumbnail: 'attachment://lspd_badge.png',
      image: 'attachment://tickets_banner.png',
      footer: {
        text: 'SSP Central Database • Secure Communication Node',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    opened: {
      color: '#1B52F1',
      author: {
        name: 'SSP CONTROL • PROTOCOLO DIGITAL',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '⚡ CANAL DE ATENDIMENTO INICIADO',
      description: (userId, staffMention) =>
        `━━━━━━ Protocolo de Atendimento Ativo ━━━━━━\n\n` +
        `• **Cidadão Solicitante:** <@${userId}>\n` +
        `• **Destinatário:** ${staffMention || 'Oficiais da Corporação'}\n\n` +
        `> Por favor, descreva a sua situação detalhadamente e anexe provas fotográficas ou gravações de vídeo. Um oficial assumirá o caso em breve.`,
      footer: {
        text: 'SSP Central Database • Aguardando Operador',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    claimed: {
      color: '#00E676',
      footer: (username) => `Assumido por ${username} • SSP`
    },
    closed: {
      color: '#D50000',
      title: 'Atendimento Finalizado',
      description: 'Status: atendimento encerrado. O canal será arquivado e purgado em 5 segundos.'
    },
    log: {
      color: '#D50000',
      author: {
        name: 'SSP ARCHIVE SYSTEM • TICKET LOG',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '📂 ARQUIVO DE PROTOCOLO DIGITAL',
      description: '━━━━━━ Detalhes do Atendimento Encerrado ━━━━━━',
      footer: (channelId) => `SSP Central System • ID: ${channelId}`
    },
    dmCopy: {
      color: '#1B52F1',
      author: {
        name: 'SECRETARIA DE SEGURANÇA PÚBLICA',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: 'Cópia de Atendimento Disponível',
      description: (ownerId, channelName) =>
        `Olá <@${ownerId}>.\n\n` +
        `Status: atendimento encerrado e transcript gerado.\n` +
        `Ticket: #${channelName}\n` +
        `Arquivo: cópia completa do processo em HTML Transcript anexada.\n` +
        `Mensagem: obrigado por cooperar com a SSP.`,
      footer: 'SSP Central System • Protegendo e Servindo'
    }
  },

  ponto: {
    panel: {
      color: '#1B52F1',
      author: {
        name: 'SSP • REGISTRO DE EXPEDIENTE',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '🛡️ CENTRAL DE PONTO ELETRÓNICO',
      description: '━━━━━━ Controle de Turnos de Patrulha ━━━━━━\n\n' +
        'Utilize os botões inferiores para **iniciar** ou **finalizar** as suas horas de patrulhamento.\n\n' +
        '• *Seu tempo em serviço é contabilizado em banco de dados e repassado para o Comando.*',
      thumbnail: 'attachment://lspd_badge.png',
      image: 'attachment://ponto_banner.png',
      footer: {
        text: 'SSP Central Command • Monitoramento Ativo',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    copom: {
      color: '#111625',
      author: {
        name: 'CENTRAL DE OPERAÇÕES POLICIAIS (COPOM)',
        iconURL: 'attachment://lspd_badge.png'
      },
      footer: {
        text: 'SSP Central System • Atualizado em tempo real',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    entrada: {
      color: '#00E676',
      title: '✅ ENTRADA REGISTRADA COM SUCESSO',
      description: (userId, timestampFormatted) =>
        `━━━━━━ Seu turno de serviço foi iniciado ━━━━━━\n\n` +
        `• **Agente:** <@${userId}>\n` +
        `• **Início:** ${timestampFormatted}\n` +
        `• **Status:** \`Em Patrulha / Ativo\``,
      footer: {
        text: 'Tenha um excelente serviço. Proteja e sirva!',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    saida: {
      color: '#D50000',
      title: '🛑 EXPEDIENTE ENCERRADO COM SUCESSO',
      description: (userId, durationFormatted) =>
        `━━━━━━ Seu turno de serviço foi finalizado ━━━━━━\n\n` +
        `• **Agente:** <@${userId}>\n` +
        `• **Duração do Turno:** \`${durationFormatted}\`\n` +
        `• **Status:** \`Fora de Serviço / QRT\``,
      footer: {
        text: 'Obrigado por patrulhar hoje! Bom descanso.',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    logEntrada: {
      color: '#00E676',
      author: {
        name: 'SSP LOG SYSTEM • EXPEDIENTE DE PONTO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '📥 INÍCIO DE TURNO REGISTRADO',
      description: (displayName) => `━━━━━━ Entrada em Serviço de Oficial ━━━━━━\n\nO oficial **${displayName}** iniciou seu patrulhamento.`,
      footer: 'Sistema de Log Eletrônico • SSP Command'
    },
    logSaida: {
      color: '#D50000',
      author: {
        name: 'SSP LOG SYSTEM • EXPEDIENTE DE PONTO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '📤 FIM DE TURNO REGISTRADO',
      description: (displayName) => `━━━━━━ Término em Serviço de Oficial ━━━━━━\n\nO oficial **${displayName}** encerrou seu patrulhamento.`,
      footer: 'Sistema de Log Eletrônico • SSP Command'
    }
  },

  edital: {
    panel: {
      color: '#1B52F1',
      author: {
        name: 'DIVISÃO DE RECRUTAMENTO E TREINAMENTO • SSP',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '🚓 PROCESSO SELETIVO • ACADEMIA DE POLÍCIA',
      description: '━━━━━━━ Faça parte da força pública ━━━━━━━\n\n' +
        'A **Secretaria de Segurança Pública** abre as suas inscrições para o recrutamento de novos oficiais. Se possui honra, disciplina e vocação para proteger e servir, inicie a sua inscrição.\n\n' +
        '📋 **COMO PROCEDER:**\n' +
        '1. Clique em **INICIAR CANDIDATURA** abaixo.\n' +
        '2. Preencha os seus dados de identificação inicial no modal.\n' +
        '3. Responda às perguntas teóricas selecionando-as no menu interativo.\n' +
        '4. Revise o rascunho e envie a ficha oficial para análise.\n\n' +
        '⚠️ **REQUISITO MÍNIMO:** *Respostas superficiais, incompletas ou com erros gramaticais crassos causarão desclassificação sumária.*',
      thumbnail: 'attachment://lspd_badge.png',
      image: 'attachment://recruitment_banner.png',
      footer: {
        text: 'SSP Recruitment Board • Terminal Eletrônico',
        iconURL: 'attachment://lspd_badge.png'
      }
    },
    draft: {
      color: '#111625',
      author: {
        name: 'SSP RECRUITMENT TERMINAL • RASCUNHO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '📝 INSCRIÇÃO EM CURSO',
      description: '━━━━━━ Painel de Respostas do Candidato ━━━━━━\n\nPreencha todas as perguntas utilizando o menu inferior. Seu progresso é gravado automaticamente. Quando finalizar, libere o envio formal.'
    },
    submission: {
      color: '#00E676',
      title: '✅ SUBMISSÃO CONFIRMADA',
      description: '━━━━━━ Formulário Registrado com Sucesso ━━━━━━\n\nSua candidatura foi entregue na Central de Recrutamento.\nO resultado final será publicado em breve no canal correspondente. Mantenha as suas comunicações ativas.',
      footer: 'Divisão de Recrutamento • SSP'
    },
    eval: {
      color: '#1B52F1',
      author: {
        name: 'SSP RECRUITMENT CONTROL • AVALIAÇÃO DE REGISTRO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: (name) => `📋 FICHA DE ADMISSÃO: ${name.toUpperCase()}`,
      description: '━━━━━━ Análise Curricular de Ingresso ━━━━━━\n\nAnalise as respostas teóricas abaixo para deferir ou indeferir a admissão do candidato.'
    },
    approved: {
      color: '#00E676',
      author: {
        name: 'SSP RECRUITMENT • AVISO DE ADMISSÃO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '🎉 CONGRATULAÇÕES! APROVADO(A)',
      description: (userId) =>
        `━━━━━━ Resultado de Processo Seletivo ━━━━━━\n\n` +
        `Saudações, <@${userId}>.\n\n` +
        `Informamos que sua candidatura foi **DEFERIDA**. Suas respostas demonstraram a aptidão e mentalidade corretas para integrar o nosso departamento.\n\n` +
        `👮‍♂️ **PASSO FINAL DE INGRESSO:**\n` +
        `Clique no botão abaixo para **ASSUMIR DISTINTIVO**. O sistema adicionará automaticamente seus cargos no servidor e gerará o número de sua insígnia oficial.\n\n` +
        `*Bem-vindo à corporação. Protegendo e Servindo.*`,
      image: 'attachment://recruitment_banner.png',
      footer: 'Central de Comando • SSP Academia de Polícia'
    },
    rejected: {
      color: '#D50000',
      author: {
        name: 'SSP RECRUITMENT • AVISO DE RESULTADO',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '❌ INDEFERIDO • REPROVADO',
      description: (userId) =>
        `━━━━━━ Resultado de Processo Seletivo ━━━━━━\n\n` +
        `Olá, <@${userId}>.\n\n` +
        `Agradecemos seu interesse em ingressar no departamento, contudo, informamos que seu formulário foi **INDEFERIDO** nesta edição.\n\n` +
        `*Nota: Não desanime. Estude os regulamentos e códigos de conduta da corporação e submeta um novo formulário na abertura do próximo edital.*`,
      footer: 'Central de Comando • SSP Academia de Polícia'
    }
  },
  ausencia: {
    panel: {
      color: '#1B52F1',
      author: {
        name: 'SSP • REGISTRO DE AUSÊNCIA',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '📝 REGISTRO DE AUSÊNCIA / LICENÇA',
      description: '━━━━━━━ Comunicação de Afastamento Programado ━━━━━━━\n\n' +
        'Caso precise se afastar de suas atividades policiais por um período determinado, registre sua solicitação por meio deste terminal.\n\n' +
        '• *Todas as solicitações de ausência são enviadas para avaliação do Comando.*\n' +
        '• *Justifique adequadamente a sua ausência para evitar indeferimento.*',
      thumbnail: 'attachment://lspd_badge.png',
      image: 'attachment://ponto_banner.png',
      footer: {
        text: 'SSP Command Control • Registro de Licenças',
        iconURL: 'attachment://lspd_badge.png'
      }
    }
  },
  warning: {
    panel: {
      color: '#D50000',
      author: {
        name: 'SSP • CENTRAL DE ADVERTÊNCIAS',
        iconURL: 'attachment://lspd_badge.png'
      },
      title: '⚠️ PAINEL DE ADVERTÊNCIAS E PUNIÇÕES',
      description: '━━━━━━━ Aplicação de Penalidades Disciplinares ━━━━━━━\n\n' +
        'Painel destinado ao Comando e Corregedoria para aplicação direta de advertências e punições a oficiais.\n\n' +
        '• *Selecione a patente do oficial para filtrar.*\n' +
        '• *Selecione o oficial, em seguida o nível da advertência e a duração.*\n' +
        '• *Justifique adequadamente toda punição aplicada.*',
      thumbnail: 'attachment://lspd_badge.png',
      image: 'attachment://ponto_banner.png',
      footer: {
        text: 'SSP Command Control • Corregedoria e Comando',
        iconURL: 'attachment://lspd_badge.png'
      }
    }
  }
};
