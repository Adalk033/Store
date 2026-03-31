import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  pageName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`ErrorBoundary [${this.props.pageName ?? 'unknown'}]:`, error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles['error-boundary']}>
          <AlertTriangle size={40} strokeWidth={1.5} className={styles['error-boundary__icon']} />
          <h2 className={styles['error-boundary__title']}>
            Algo salio mal
          </h2>
          <p className={styles['error-boundary__message']}>
            Ocurrio un error inesperado{this.props.pageName ? ` en ${this.props.pageName}` : ''}. Puedes intentar recargar la seccion.
          </p>
          {this.state.error && (
            <pre className={styles['error-boundary__details']}>
              {this.state.error.message}
            </pre>
          )}
          <button className={styles['error-boundary__btn']} onClick={this.handleReset}>
            <RefreshCw size={14} strokeWidth={1.5} />
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
