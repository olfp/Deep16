graph TD
    %% Core Element
    Core[Deep16 3 stage core]

    %% Top Blocks
    BootROM[Boot ROM]
    ExtFlash[External Flash]
    MEM[MEM]
    Cache[Cache]
    SIC[SIC]

    %% Right Blocks
    Timer[Timer]
    PS2[PS/2]
    I2SAudio[I2S Audio]
    PCMAmp[PCM Amp]

    %% Left Blocks
    SDCard[SD Card]
    SPIMaster[SPI Master]
    UART[UART]
    USBCSerial[USB-C Serial]

    %% Bottom Blocks
    VMEM[VMEM]
    FITGfx[FIT Gfx]
    Clk[Clk]

    %% Connections
    Core --> BootROM
    Core --> ExtFlash
    Core <--> MEM
    Core <--> Cache
    SIC --> Core

    Core <--> Timer
    Core <--> PS2
    Core --> I2SAudio
    I2SAudio <--> PCMAmp

    SDCard <--> SPIMaster
    SPIMaster <--> Core
    USBCSerial <--> UART
    UART <--> Core

    Core --> VMEM
    Core --> FITGfx
    VMEM <--> FITGfx

    %% Styling (Optional Color Matching)
    style Core fill:#F9A825,stroke:#333,stroke-width:2px;
    style FITGfx fill:#EF5350,stroke:#333,stroke-width:2px;
    
    style BootROM fill:#C5CAE9,stroke:#333;
    style ExtFlash fill:#C5CAE9,stroke:#333;
    style MEM fill:#E1BEE7,stroke:#333;
    style Cache fill:#E1BEE7,stroke:#333;
    style VMEM fill:#E1BEE7,stroke:#333;
    style SIC fill:#7986CB,stroke:#333;

    style Timer fill:#81C784,stroke:#333;
    style PS2 fill:#81C784,stroke:#333;
    style I2SAudio fill:#81C784,stroke:#333;
    style PCMAmp fill:#81C784,stroke:#333;
    style SDCard fill:#81C784,stroke:#333;
    style SPIMaster fill:#81C784,stroke:#333;
    style UART fill:#81C784,stroke:#333;
    style USBCSerial fill:#81C784,stroke:#333;
    
    style Clk fill:#B0BEC5,stroke:#333;
