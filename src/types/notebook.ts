export type NotebookOutputImage = {
  image_data: string;
  media_type: 'image/png' | 'image/jpeg';
};

export type NotebookCellSourceOutput =
  | {
      output_type: 'stream';
      text?: string;
      image?: NotebookOutputImage;
    }
  | {
      output_type: 'execute_result' | 'display_data';
      text?: string;
      image?: NotebookOutputImage;
    }
  | {
      output_type: 'error';
      text?: string;
      image?: NotebookOutputImage;
    };

export type NotebookCellSource = {
  cellType: 'code' | 'markdown' | string;
  source: string;
  execution_count?: number;
  cell_id: string;
  language?: string;
  outputs?: NotebookCellSourceOutput[];
};

export type NotebookCellOutput =
  | {
      output_type: 'stream';
      text?: string | string[];
    }
  | {
      output_type: 'execute_result' | 'display_data';
      data?: Record<string, unknown>;
    }
  | {
      output_type: 'error';
      ename: string;
      evalue: string;
      traceback: string[];
    };

export type NotebookCell = {
  id?: string;
  cell_type: 'code' | 'markdown' | string;
  source: string | string[];
  execution_count?: number | null;
  outputs?: NotebookCellOutput[];
};

export type NotebookContent = {
  metadata: {
    language_info?: {
      name?: string;
    };
    [key: string]: unknown;
  };
  cells: NotebookCell[];
  [key: string]: unknown;
};
